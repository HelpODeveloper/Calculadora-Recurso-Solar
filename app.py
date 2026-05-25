"""
app.py
Servidor Flask para el Motor Solar Fotovoltaico.
Expone la API REST y sirve el frontend.

Uso:
    python app.py
    Abrir: http://localhost:5000
"""

import io
import json
import numpy as np
import pandas as pd
from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

from demand_profile import generate_demand_profile
from solar_engine import run_solar_engine

app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Almacén de sesión simple (para el endpoint de descarga)
_session_cache = {}


# ─────────────────────────────────────────────────────────────────────────────
# FRONTEND
# ─────────────────────────────────────────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


# ─────────────────────────────────────────────────────────────────────────────
# API: PERFIL DE DEMANDA
# ─────────────────────────────────────────────────────────────────────────────
@app.route('/api/demand', methods=['POST'])
def api_demand():
    """
    Genera el perfil de demanda industrial quinceminutal.

    Body JSON:
    {
      "pmax_kW"     : 50,     // 30, 50 o 60
      "fc_planta"   : 0.60,   // 0.50 – 0.70
      "fp_potencia" : 0.85    // 0.70 – 0.95
    }
    """
    try:
        data = request.get_json(force=True)
        Pmax    = float(data.get('pmax_kW', 50))
        FC      = float(data.get('fc_planta', 0.60))
        FP      = float(data.get('fp_potencia', 0.85))

        # Validaciones
        if Pmax not in (30, 50, 60):
            Pmax = min([30, 50, 60], key=lambda x: abs(x - Pmax))
        FC = np.clip(FC, 0.50, 0.70)
        FP = np.clip(FP, 0.70, 0.95)

        result = generate_demand_profile(Pmax, FC, FP)

        # Guardar en caché para descarga
        _session_cache['demand'] = result

        # Solo retornamos los datos necesarios para el frontend (no el array completo)
        return jsonify({
            'ok': True,
            'monthly_avg': result['monthly_avg'],
            'monthly_max': result['monthly_max'],
            'monthly_min': result['monthly_min'],
            'daily_profile': result['daily_profile'],
            'stats': result['stats'],
        })

    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 400


# ─────────────────────────────────────────────────────────────────────────────
# API: MOTOR SOLAR
# ─────────────────────────────────────────────────────────────────────────────
@app.route('/api/solar', methods=['POST'])
def api_solar():
    """
    Ejecuta el motor Jensen y calcula la generación PV anual.

    Body JSON:
    {
      "lat"          : 25.67,   // Latitud [°]
      "lon"          : -100.31, // Longitud [°]
      "alt"          : 538,     // Altitud [m]
      "eta"          : 0.20,    // Eficiencia panel [0–1]
      "area_m2"      : 2.0,     // Área panel [m²]
      "n_panels"     : 20,      // Número de paneles
      "tilt"         : 25,      // Inclinación [°]
      "azimuth"      : 180,     // Azimut [°] 180=Sur
      "p_nominal_w"  : 400      // Potencia nominal del panel [W]
    }
    """
    try:
        data = request.get_json(force=True)

        lat         = float(data.get('lat', 25.67))
        lon         = float(data.get('lon', -100.31))
        alt         = float(data.get('alt', 538))
        eta         = float(data.get('eta', 0.20))
        area_m2     = float(data.get('area_m2', 2.0))
        n_panels    = int(data.get('n_panels', 20))
        tilt        = float(data.get('tilt', 25.0))
        azimuth     = float(data.get('azimuth', 180.0))
        p_nominal_w = float(data.get('p_nominal_w', 400))

        # Validaciones básicas
        lat  = np.clip(lat,  -90, 90)
        eta  = np.clip(eta,  0.05, 0.50)
        tilt = np.clip(tilt, 0, 90)
        n_panels = max(1, n_panels)

        result = run_solar_engine(lat, lon, alt, eta, area_m2, n_panels,
                                  tilt, azimuth, p_nominal_w)

        # Calcular balance si hay perfil de demanda en caché
        balance = None
        if 'demand' in _session_cache:
            dem = _session_cache['demand']
            dem_arr = np.array(dem['demand_kW'])
            gen_arr = np.array(result['P_kw_arr'])
            exceso = np.maximum(gen_arr - dem_arr, 0)
            deficit = np.maximum(dem_arr - gen_arr, 0)
            energia_dem = float(np.sum(dem_arr) * 0.25)
            energia_gen = float(np.sum(gen_arr) * 0.25)
            cobertura = min(energia_gen / energia_dem * 100, 100) if energia_dem > 0 else 0

            # Balance mensual
            days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
            monthly_balance = []
            monthly_cobertura = []
            idx = 0
            for n_days in days_in_month:
                n_pts = n_days * 96
                e_gen = float(np.sum(gen_arr[idx:idx+n_pts]) * 0.25)
                e_dem = float(np.sum(dem_arr[idx:idx+n_pts]) * 0.25)
                monthly_balance.append(e_gen - e_dem)
                monthly_cobertura.append(min(e_gen / e_dem * 100, 100) if e_dem > 0 else 0)
                idx += n_pts

            balance = {
                'energia_demanda_kWh': energia_dem,
                'energia_generada_kWh': energia_gen,
                'cobertura_pct': cobertura,
                'exceso_kWh': float(np.sum(exceso) * 0.25),
                'deficit_kWh': float(np.sum(deficit) * 0.25),
                'monthly_balance': monthly_balance,
                'monthly_cobertura': monthly_cobertura,
            }

        # Guardar en caché para descarga
        _session_cache['solar'] = result

        return jsonify({
            'ok': True,
            'monthly_gtot_avg': result['monthly_gtot_avg'],
            'monthly_gtot_max': result['monthly_gtot_max'],
            'monthly_gen_kWh': result['monthly_gen_kWh'],
            'daily_gtot_summer': result['daily_gtot_summer'],
            'daily_p_summer': result['daily_p_summer'],
            'stats': result['stats'],
            'balance': balance,
        })

    except Exception as e:
        import traceback
        return jsonify({'ok': False, 'error': str(e), 'trace': traceback.format_exc()}), 400


# ─────────────────────────────────────────────────────────────────────────────
# API: DESCARGA CSV
# ─────────────────────────────────────────────────────────────────────────────
@app.route('/api/download', methods=['GET'])
def api_download():
    """Genera y retorna un CSV con los datos anuales calculados."""
    if 'solar' not in _session_cache:
        return jsonify({'ok': False, 'error': 'No hay datos de cálculo disponibles. Ejecute primero el motor solar.'}), 400

    solar = _session_cache['solar']
    hours = solar['hours']
    Gtot  = solar['Gtot_arr']
    P_kw  = solar['P_kw_arr']

    df_data = {
        'Hora_del_Año_[h]': hours,
        'Irradiancia_POA_[W/m2]': Gtot,
        'Generacion_PV_[kW]': P_kw,
    }

    if 'demand' in _session_cache:
        df_data['Demanda_[kW]'] = _session_cache['demand']['demand_kW']

    df = pd.DataFrame(df_data)

    # Agregar columnas de fecha
    import datetime
    base = datetime.datetime(2024, 1, 1, 0, 0)
    df.insert(0, 'Fecha_Hora', [
        (base + datetime.timedelta(hours=h)).strftime('%Y-%m-%d %H:%M')
        for h in hours
    ])

    buf = io.StringIO()
    df.to_csv(buf, index=False, float_format='%.4f')
    buf.seek(0)

    return send_file(
        io.BytesIO(buf.getvalue().encode('utf-8')),
        mimetype='text/csv',
        as_attachment=True,
        download_name='motor_solar_resultados.csv'
    )


# ─────────────────────────────────────────────────────────────────────────────
# ENTRADA
# ─────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    print("=" * 60)
    print("  Motor Solar Fotovoltaico — Servidor Flask")
    print("  Abrir en navegador: http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, port=5000, use_reloader=False)
