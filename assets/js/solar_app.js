/**
 * solar_app.js
 * Lógica del frontend para el Motor Solar Fotovoltaico
 * Maneja: formularios, llamadas a la API Flask, Chart.js, animaciones
 */

// ─────────────────────────────────────────────────────────────────────────────
// ESTADO GLOBAL
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  demandData: null,
  solarData:  null,
  charts: {}
};

const MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const HOURS_96 = Array.from({length: 96}, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
});

// ─────────────────────────────────────────────────────────────────────────────
// UTILIDADES
// ─────────────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showLoader(text = 'Calculando...') {
  const ol = $('loader-overlay');
  ol.querySelector('.loader-text').textContent = text;
  ol.classList.add('active');
}
function hideLoader() { $('loader-overlay').classList.remove('active'); }

function showAlert(containerId, type, msg) {
  const el = $(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">
    <span>${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
    <span>${msg}</span>
  </div>`;
}

function formatNum(n, dec = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDERS EN TIEMPO REAL
// ─────────────────────────────────────────────────────────────────────────────
function initSliders() {
  const sliders = [
    { slider: 'fc-planta',      display: 'fc-planta-val',      suffix: '%',  multiplier: 100, decimals: 0 },
    { slider: 'fp-potencia',    display: 'fp-potencia-val',    suffix: '',   multiplier: 1,   decimals: 2 },
    { slider: 'eta-panel',      display: 'eta-panel-val',      suffix: '%',  multiplier: 100, decimals: 0 },
    { slider: 'tilt-angle',     display: 'tilt-val',           suffix: '°',  multiplier: 1,   decimals: 0 },
    { slider: 'weekend-factor', display: 'weekend-factor-val', suffix: '%',  multiplier: 100, decimals: 0 },
    { slider: 'summer-boost',   display: 'summer-boost-val',   suffix: '',   multiplier: 1,   decimals: 2, prefix: '×' },
  ];
  sliders.forEach(({ slider, display, suffix, multiplier, decimals, prefix }) => {
    const el = $(slider), disp = $(display);
    if (!el || !disp) return;
    const update = () => {
      const v = parseFloat(el.value) * multiplier;
      disp.textContent = `${prefix || ''}${v.toFixed(decimals)}${suffix}`;
    };
    el.addEventListener('input', update);
    update();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART.JS — COLORES GLOBALES
// ─────────────────────────────────────────────────────────────────────────────
Chart.defaults.color = '#94a3b8';
Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
Chart.defaults.font.family = "'Inter', sans-serif";

function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 1: PERFIL DE DEMANDA
// ─────────────────────────────────────────────────────────────────────────────
async function runDemand() {
  const Pmax          = parseFloat($('pmax-input')?.value ?? 50);
  const FC            = parseFloat($('fc-planta').value);
  const FP            = parseFloat($('fp-potencia').value);
  const n_shifts      = parseInt($('n-shifts-select').value);
  const plant_type    = $('plant-type-select').value;
  const weekend_op    = parseFloat($('weekend-factor').value);
  const summer_boost  = parseFloat($('summer-boost').value);

  showLoader('⚡ Generando perfil de demanda anual (35,040 puntos)...');
  try {
    const res = await fetch('/api/demand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pmax_kW          : Pmax,
        fc_planta        : FC,
        fp_potencia      : FP,
        n_shifts         : n_shifts,
        plant_type       : plant_type,
        weekend_op_factor: weekend_op,
        summer_boost     : summer_boost,
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    state.demandData = data;
    renderDemandCharts(data);
    renderDemandStats(data.stats);
    $('demand-results').classList.remove('hidden');
    $('demand-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showAlert('demand-alert', 'success', `Perfil generado — ${data.stats.plant_name} · ${n_shifts} turno(s) · Pmax ${Pmax} kW`);
  } catch (e) {
    showAlert('demand-alert', 'error', `Error: ${e.message}`);
  } finally {
    hideLoader();
  }
}

function renderDemandCharts(data) {
  // Gráfica 1: Demanda mensual promedio (barras)
  destroyChart('demandMonthly');
  state.charts.demandMonthly = new Chart($('chart-demand-monthly'), {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        {
          label: 'Promedio [kW]',
          data: data.monthly_avg,
          backgroundColor: 'rgba(249,115,22,0.75)',
          borderColor: '#f97316',
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: 'Máximo [kW]',
          data: data.monthly_max,
          type: 'line',
          borderColor: '#fbbf24',
          backgroundColor: 'transparent',
          pointBackgroundColor: '#fbbf24',
          pointRadius: 3,
          borderWidth: 2,
          tension: 0.4,
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: c => ` ${formatNum(c.raw, 2)} kW` } }
      },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => `${v} kW` } }
      }
    }
  });

  // Gráfica 2: Perfil diario representativo (línea)
  destroyChart('demandDaily');
  state.charts.demandDaily = new Chart($('chart-demand-daily'), {
    type: 'line',
    data: {
      labels: HOURS_96,
      datasets: [{
        label: 'Demanda típica día laboral [kW]',
        data: data.daily_profile,
        borderColor: '#f97316',
        backgroundColor: 'rgba(249,115,22,0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        borderWidth: 2,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 12,
            callback: (v, i) => i % 8 === 0 ? HOURS_96[i] : ''
          },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => `${v.toFixed(0)} kW` } }
      }
    }
  });
}

function renderDemandStats(stats) {
  const el = $('demand-stats-box');
  if (!el) return;
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-orange">⚡</div>
        <div class="stat-info">
          <div class="stat-label">Energía anual consumida</div>
          <div class="stat-val">${formatNum(stats.energia_anual_MWh, 2)} <span>MWh/año</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-blue">📊</div>
        <div class="stat-info">
          <div class="stat-label">Demanda media</div>
          <div class="stat-val">${formatNum(stats.p_media_kW, 2)} <span>kW</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-gold">🏭</div>
        <div class="stat-info">
          <div class="stat-label">Factor de carga real</div>
          <div class="stat-val">${formatNum(stats.factor_carga_real * 100, 1)} <span>%</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-green">⏱️</div>
        <div class="stat-info">
          <div class="stat-label">Horas equiv. a plena carga</div>
          <div class="stat-val">${formatNum(stats.horas_punta_equiv, 0)} <span>hrs/año</span></div>
        </div>
      </div>
    </div>`;
  el.classList.add('visible');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECCIÓN 2: MOTOR SOLAR
// ─────────────────────────────────────────────────────────────────────────────
async function runSolar() {
  const payload = {
    lat:          parseFloat($('input-lat').value),
    lon:          parseFloat($('input-lon').value),
    alt:          parseFloat($('input-alt').value),
    eta:          parseFloat($('eta-panel').value),
    area_m2:      parseFloat($('input-area').value),
    n_panels:     parseInt($('input-npanels').value),
    tilt:         parseFloat($('tilt-angle').value),
    azimuth:      parseFloat($('input-azimuth').value),
    p_nominal_w:  parseFloat($('input-pnominal').value),
  };

  // Validación básica
  if (isNaN(payload.lat) || isNaN(payload.lon)) {
    showAlert('solar-alert', 'error', 'Por favor ingresa latitud y longitud válidas.');
    return;
  }

  showLoader('☀️ Ejecutando Motor de Jensen — 35,040 intervalos de 15 min...');
  try {
    const res = await fetch('/api/solar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    state.solarData = data;
    renderSolarCharts(data);
    renderSolarKPIs(data.stats, data.balance);
    renderSolarStats(data.stats, data.balance);
    $('solar-results').classList.remove('hidden');
    $('solar-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
    showAlert('solar-alert', 'success', 'Cálculo completado. Los resultados se muestran a continuación.');
  } catch (e) {
    showAlert('solar-alert', 'error', `Error en el cálculo: ${e.message}`);
    console.error(e);
  } finally {
    hideLoader();
  }
}

function renderSolarKPIs(stats, balance) {
  const kpis = [
    { id: 'kpi-energia', val: formatNum(stats.energia_anual_MWh, 2), unit: 'MWh/año', label: 'Energía generada', color: '#f97316' },
    { id: 'kpi-fc',      val: formatNum(stats.factor_capacidad_pct, 1), unit: '%', label: 'Factor de capacidad', color: '#fbbf24' },
    { id: 'kpi-pmax',    val: formatNum(stats.p_max_kW, 2), unit: 'kW', label: 'Pico de generación', color: '#3b82f6' },
    { id: 'kpi-irrad',   val: formatNum(stats.irrad_poa_kWh_m2, 0), unit: 'kWh/m²', label: 'Irradiación POA anual', color: '#f97316' },
    { id: 'kpi-hpse',    val: formatNum(stats.horas_pico_sol_equiv, 0), unit: 'hrs', label: 'Horas pico solar equiv.', color: '#10b981' },
    { id: 'kpi-cob',     val: balance ? formatNum(balance.cobertura_pct, 1) : '—', unit: '%', label: 'Cobertura de demanda', color: '#10b981' },
  ];

  const container = $('kpi-container');
  container.innerHTML = kpis.map(k => `
    <div class="kpi-card" style="--kpi-color:${k.color}">
      <div class="kpi-value">${k.val}<span class="kpi-unit"> ${k.unit}</span></div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');
}

function renderSolarCharts(data) {
  const { stats, balance } = data;

  // Gráfica 1: Irradiancia POA mensual
  destroyChart('gtotMonthly');
  state.charts.gtotMonthly = new Chart($('chart-gtot-monthly'), {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [{
        label: 'Irradiancia POA media [W/m²]',
        data: data.monthly_gtot_avg,
        backgroundColor: ctx => {
          const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 300);
          g.addColorStop(0, 'rgba(251,191,36,0.9)');
          g.addColorStop(1, 'rgba(249,115,22,0.5)');
          return g;
        },
        borderRadius: 5,
        borderSkipped: false,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${formatNum(c.raw, 1)} W/m²` } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => `${v} W/m²` } }
      }
    }
  });

  // Gráfica 2: Generación mensual kWh
  destroyChart('genMonthly');
  state.charts.genMonthly = new Chart($('chart-gen-monthly'), {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [{
        label: 'Generación [kWh/mes]',
        data: data.monthly_gen_kWh,
        backgroundColor: 'rgba(16,185,129,0.7)',
        borderColor: '#10b981',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${formatNum(c.raw, 0)} kWh` } } },
      scales: {
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => `${(v/1000).toFixed(1)} MWh` } }
      }
    }
  });

  // Gráfica 3: Perfil diario verano (generación + demanda si disponible)
  destroyChart('dailyProfile');
  const datasets = [{
    label: 'Generación PV (verano promedio) [kW]',
    data: data.daily_p_summer,
    borderColor: '#fbbf24',
    backgroundColor: 'rgba(251,191,36,0.1)',
    fill: true,
    tension: 0.4,
    pointRadius: 0,
    borderWidth: 2,
  }];
  if (state.demandData) {
    datasets.push({
      label: 'Demanda industrial [kW]',
      data: state.demandData.daily_profile,
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.05)',
      fill: true,
      tension: 0.4,
      pointRadius: 0,
      borderWidth: 2,
      borderDash: [5, 3],
    });
  }
  destroyChart('dailyComp');
  state.charts.dailyComp = new Chart($('chart-daily-comp'), {
    type: 'line',
    data: {
      labels: HOURS_96,
      datasets
    },
    options: {
      responsive: true,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } } },
      scales: {
        x: { ticks: { maxTicksLimit: 12, callback: (v, i) => i % 8 === 0 ? HOURS_96[i] : '' }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => `${v.toFixed(0)} kW` } }
      }
    }
  });

  // Gráfica 4: Balance mensual (si hay demanda)
  if (balance) {
    destroyChart('balanceMonthly');
    state.charts.balanceMonthly = new Chart($('chart-balance'), {
      type: 'bar',
      data: {
        labels: MONTHS,
        datasets: [
          {
            label: 'Generación [kWh]',
            data: data.monthly_gen_kWh,
            backgroundColor: 'rgba(16,185,129,0.6)',
            borderRadius: 3,
            stack: 'stack0',
          },
          {
            label: 'Demanda [kWh]',
            data: state.demandData.monthly_avg.map((v, i) => {
              const days = [31,28,31,30,31,30,31,31,30,31,30,31][i];
              return v * days * 24;
            }),
            backgroundColor: 'rgba(249,115,22,0.5)',
            borderRadius: 3,
            stack: 'stack1',
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: c => ` ${formatNum(c.raw/1000, 2)} MWh` } }
        },
        scales: {
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { callback: v => `${(v/1000).toFixed(1)} MWh` } }
        }
      }
    });
  }
}

function renderSolarStats(stats, balance) {
  const el = $('solar-stats-box');
  if (!el) return;

  const covPct = balance ? balance.cobertura_pct : null;
  const coverageBar = covPct !== null
    ? `<div class="balance-bar-wrap">
        <div class="balance-bar-label">
          <span>🌞 Cobertura de Demanda por Generación Solar</span>
          <strong style="color:var(--accent-green)">${formatNum(covPct, 1)}%</strong>
        </div>
        <div class="balance-bar-track">
          <div class="balance-bar-fill" style="width:${Math.min(covPct,100)}%"></div>
        </div>
      </div>` : '';

  el.innerHTML = `
    ${coverageBar}
    <div class="stats-grid">
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-gold">☀️</div>
        <div class="stat-info">
          <div class="stat-label">Irradiación horizontal anual</div>
          <div class="stat-val">${formatNum(stats.irrad_horizontal_kWh_m2, 0)} <span>kWh/m²</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-orange">📐</div>
        <div class="stat-info">
          <div class="stat-label">Irradiación POA anual</div>
          <div class="stat-val">${formatNum(stats.irrad_poa_kWh_m2, 0)} <span>kWh/m²</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-orange">⚡</div>
        <div class="stat-info">
          <div class="stat-label">Energía generada</div>
          <div class="stat-val">${formatNum(stats.energia_anual_kWh, 0)} <span>kWh/año</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-blue">🔋</div>
        <div class="stat-info">
          <div class="stat-label">Potencia pico del sistema</div>
          <div class="stat-val">${formatNum(stats.p_nominal_total_kW, 2)} <span>kWp</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-green">📈</div>
        <div class="stat-info">
          <div class="stat-label">Factor de capacidad</div>
          <div class="stat-val">${formatNum(stats.factor_capacidad_pct, 2)} <span>%</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-gold">🕐</div>
        <div class="stat-info">
          <div class="stat-label">Horas de generación/año</div>
          <div class="stat-val">${formatNum(stats.n_horas_generacion, 0)} <span>hrs</span></div>
        </div>
      </div>
      ${balance ? `
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-green">✅</div>
        <div class="stat-info">
          <div class="stat-label">Energía cubierta por solar</div>
          <div class="stat-val">${formatNum(Math.min(balance.energia_generada_kWh, balance.energia_demanda_kWh) / 1000, 2)} <span>MWh/año</span></div>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-icon-wrap stat-icon-blue">🔌</div>
        <div class="stat-info">
          <div class="stat-label">Déficit de red eléctrica</div>
          <div class="stat-val">${formatNum(balance.deficit_kWh / 1000, 2)} <span>MWh/año</span></div>
        </div>
      </div>` : ''}
    </div>`;
  el.classList.add('visible');
}

// ─────────────────────────────────────────────────────────────────────────────
// DESCARGA CSV
// ─────────────────────────────────────────────────────────────────────────────
function downloadExcel() {
  if (!state.solarData) {
    alert('Ejecuta primero el Motor Solar para generar los datos.');
    return;
  }
  window.location.href = '/api/download/excel';
}

// ─────────────────────────────────────────────────────────────────────────────
// ANIMACIONES DE SCROLL
// ─────────────────────────────────────────────────────────────────────────────
function initScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.fade-in').forEach(el => obs.observe(el));
}

// ─────────────────────────────────────────────────────────────────────────────
// SCROLL SUAVE AL ANCLA
// ─────────────────────────────────────────────────────────────────────────────
function scrollTo(id) {
  const el = document.getElementById(id);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────────────────────────────────────
// INICIO
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSliders();
  initScrollAnimations();

  // Botones
  $('btn-demand')?.addEventListener('click', runDemand);
  $('btn-solar')?.addEventListener('click', runSolar);
  $('btn-download')?.addEventListener('click', downloadExcel);

  // Ocultar secciones de resultados hasta que se calculen
  ['demand-results', 'solar-results'].forEach(id => {
    const el = $(id);
    if (el) el.classList.add('hidden');
  });
});
