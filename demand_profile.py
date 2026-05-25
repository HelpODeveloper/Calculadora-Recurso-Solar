"""
demand_profile.py
Generador de perfil de demanda industrial quinceminutal (15-min).
Genera 35,040 puntos = 365 días × 24 hrs × 4 intervalos.
"""

import numpy as np


def generate_demand_profile(Pmax_kW: float, FC_planta: float, FP_potencia: float) -> dict:
    """
    Genera la curva de carga quinceminutal anual de una planta industrial.

    Args:
        Pmax_kW    : Demanda máxima de la planta [kW] (30, 50 o 60)
        FC_planta  : Factor de carga de la planta [0.50 – 0.70]
        FP_potencia: Factor de potencia [0.70 – 0.95]

    Returns:
        dict con:
            - 'demand_kW'     : array (35,040,) demanda cada 15 min [kW]
            - 'hours'         : array (35,040,) horas del año [0, 0.25, 0.5 ...]
            - 'monthly_avg'   : array (12,) promedio mensual [kW]
            - 'monthly_max'   : array (12,) máximo mensual [kW]
            - 'monthly_min'   : array (12,) mínimo mensual [kW]
            - 'daily_profile' : array (96,) perfil diario representativo
            - 'stats'         : dict con estadísticas globales
    """
    np.random.seed(42)

    N = 35040  # puntos totales en el año
    demand = np.zeros(N)

    # Días del año de referencia (2024 = año bisiesto simplificado a 365)
    days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

    # Meses de verano (México): mayo - sep (índices 4 a 8)
    summer_months = {4, 5, 6, 7, 8}

    idx = 0
    for month_idx, n_days in enumerate(days_in_month):
        is_summer = month_idx in summer_months
        season_factor = 1.15 if is_summer else 1.0

        for day in range(n_days):
            # Día de la semana: 0=lunes, 6=domingo (2024 empieza en lunes)
            day_of_year = sum(days_in_month[:month_idx]) + day
            weekday = day_of_year % 7  # 0-4 laboral, 5-6 finde

            is_weekend = weekday >= 5
            weekend_factor = 0.60 if is_weekend else 1.0

            for interval in range(96):  # 96 intervalos de 15 min por día
                hour_of_day = interval / 4.0  # hora real (0.0 – 23.75)

                # Perfil horario industrial base
                base = _industrial_hourly_profile(hour_of_day, is_weekend)

                # Aplicar factores
                p = Pmax_kW * base * FC_planta * season_factor * weekend_factor

                # Ruido gaussiano ±5%
                noise = np.random.normal(1.0, 0.05)
                p = max(0.0, p * noise)

                demand[idx] = p
                idx += 1

    # ── Post-proceso ──────────────────────────────────────────────────────────
    # Escalar para que el máximo real sea ≈ Pmax_kW
    if demand.max() > 0:
        demand = demand * (Pmax_kW / demand.max()) * FP_potencia

    hours = np.arange(N) * 0.25  # horas del año

    # Promedios mensuales (kW)
    monthly_avg = []
    monthly_max = []
    monthly_min = []
    idx = 0
    for n_days in days_in_month:
        n_pts = n_days * 96
        segment = demand[idx: idx + n_pts]
        monthly_avg.append(float(np.mean(segment)))
        monthly_max.append(float(np.max(segment)))
        monthly_min.append(float(np.min(segment)))
        idx += n_pts

    # Perfil diario representativo (promedio de todos los días laborales)
    daily_profile = np.zeros(96)
    count = 0
    for d in range(365):
        if d % 7 < 5:  # día laboral
            daily_profile += demand[d * 96: d * 96 + 96]
            count += 1
    if count > 0:
        daily_profile /= count

    # Estadísticas globales
    energy_kwh = float(np.sum(demand) * 0.25)  # kWh anuales
    stats = {
        'pmax_kW': float(Pmax_kW),
        'p_media_kW': float(np.mean(demand)),
        'p_min_kW': float(np.min(demand)),
        'p_max_kW': float(np.max(demand)),
        'energia_anual_kWh': energy_kwh,
        'energia_anual_MWh': energy_kwh / 1000,
        'factor_carga_real': float(np.mean(demand) / np.max(demand)) if np.max(demand) > 0 else 0,
        'horas_punta_equiv': energy_kwh / Pmax_kW if Pmax_kW > 0 else 0,
        'FC_planta': FC_planta,
        'FP_potencia': FP_potencia,
    }

    return {
        'demand_kW': demand.tolist(),
        'hours': hours.tolist(),
        'monthly_avg': monthly_avg,
        'monthly_max': monthly_max,
        'monthly_min': monthly_min,
        'daily_profile': daily_profile.tolist(),
        'stats': stats,
    }


def _industrial_hourly_profile(hour: float, is_weekend: bool) -> float:
    """
    Perfil horario industrial normalizado [0–1] para una planta manufacturera.
    Modela: arranque, producción plena, turno medio, bajada nocturna.
    """
    if is_weekend:
        # Fin de semana: planta en mantenimiento / guardia mínima
        if 0 <= hour < 6:
            return 0.15
        elif 6 <= hour < 10:
            return 0.30
        elif 10 <= hour < 16:
            return 0.45
        elif 16 <= hour < 20:
            return 0.35
        else:
            return 0.20
    else:
        # Día laboral: 3 turnos típicos de manufactura
        if 0 <= hour < 5:        # Turno nocturno bajo
            return 0.35
        elif 5 <= hour < 6:      # Arranque turno mañana
            return 0.60
        elif 6 <= hour < 8:      # Rampa de producción
            return 0.80
        elif 8 <= hour < 12:     # Producción plena turno 1
            return 1.00
        elif 12 <= hour < 13:    # Comida / ajuste de turno
            return 0.70
        elif 13 <= hour < 17:    # Producción plena turno 2
            return 0.95
        elif 17 <= hour < 18:    # Cambio de turno
            return 0.75
        elif 18 <= hour < 22:    # Turno nocturno parcial
            return 0.65
        else:                    # Madrugada
            return 0.40