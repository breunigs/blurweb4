/**
 * Minimal i18n — English and German UI strings.
 * Debug/console log strings are intentionally left in English throughout the codebase.
 *
 * Language selection: use German when the browser's first preferred language starts
 * with "de", otherwise fall back to English.
 */

export type Lang = 'en' | 'de';

const LANG_KEY = 'blurweb4-lang';

export const lang: Lang = (() => {
  const stored = localStorage.getItem(LANG_KEY);
  if (stored === 'en' || stored === 'de') return stored;
  const first = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  return first.startsWith('de') ? 'de' : 'en';
})();

export function getLangPref(): Lang | 'auto' {
  const stored = localStorage.getItem(LANG_KEY);
  return stored === 'en' || stored === 'de' ? stored : 'auto';
}

export function setLang(l: Lang | 'auto'): void {
  if (l === 'auto') {
    localStorage.removeItem(LANG_KEY);
  } else {
    localStorage.setItem(LANG_KEY, l);
  }
  location.reload();
}

export function initLangControls(): void {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[name="lang"]');
  const current = getLangPref();
  inputs.forEach(input => {
    if (input.value === current) input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) setLang(input.value as Lang | 'auto');
    });
  });
}

const STRINGS = {
  en: {
    // Page
    page_title: 'Media Redactor',

    // Step 1 — Load
    step_load: 'Load files',
    dropzone_text: 'Drop images or videos here',
    btn_choose_files: 'Choose files',
    btn_load_examples: 'Load examples',

    // Step 2 — Redaction
    step_preview: 'Preview & trim',
    step_redaction: 'Redaction',
    aria_prev: 'Previous file',
    aria_file_select: 'Selected file',
    aria_next: 'Next file',
    detecting: 'Detecting\u2026',
    libav_warning: 'Software decoder active \u2014 seeking may be slow',
    trim_label: 'Trim range',
    trim_start: 'Start',
    trim_end: 'End',

    // Step 3 — Settings
    step_settings: 'Settings',
    setting_model: 'Detection model',
    model_small: 'Fast \u2014 small (8\u00a0MB)',
    model_large: 'Accurate \u2014 large (178\u00a0MB)',
    setting_metadata: 'Metadata',
    setting_audio: 'Audio',
    keep: 'Keep',
    metadata_gps: 'GPS only',
    strip: 'Strip',
    setting_confidence: 'Min. confidence',
    setting_redaction: 'Redaction style',
    naming_pattern: 'Filename pattern',
    naming_col_variable: 'Variable',
    naming_col_desc: 'Description',
    naming_col_value: 'Value',
    var_desc_input: 'Original filename (without extension)',
    var_desc_index: 'Export position (1, 2, 3\u2026)',
    var_desc_year: 'Year from file metadata',
    var_desc_month: 'Month (01\u201312)',
    var_desc_day: 'Day (01\u201331)',
    var_desc_hour: 'Hour (00\u201323)',
    var_desc_minute: 'Minute (00\u201359)',
    var_desc_timezone: 'UTC offset',
    var_desc_lat: 'GPS latitude',
    var_desc_lon: 'GPS longitude',
    var_desc_duration: 'Video duration (hh:mm:ss)',
    mode_blur: 'Blur',
    mode_blackout: 'Solid color',
    mode_pixelate: 'Pixelate',
    mode_outline: 'Outline (debug)',

    // Step 4 — Export
    step_export: 'Export',
    btn_export: 'Export {name}',
    btn_export_all: 'Export all ({n})',
    overall: 'Overall',

    // Step 5 — Debug
    step_debug: 'Debug',
    debug_subtitle: 'All console output captured here',
    btn_copy: 'Copy to clipboard',
    btn_clear: 'Clear',
    btn_delete_detections: 'Delete detections',
    btn_defaults: 'Restore default settings',
    confirm_delete_detections: 'Delete all cached detections?',

    // Explainer
    explainer_top:
      'Automatically blurs faces and license plates in your photos and videos. Everything runs on your device \u2014 nothing is uploaded. Detection is not perfect, so always check the result before you share.',
    explainer_more: 'Learn more \u2193',
    explainer_mobile_note:
      'Works better on a desktop or laptop \u2014 mobile devices are usually too slow.',
    explainer_h2: 'How it works',
    explainer_processing_dt: 'Processing happens in the browser',
    explainer_processing_dd:
      'Decoding, detection, and export all run as code inside the browser tab. The files are read from disk into browser memory and are not transmitted over the network.',
    explainer_detects_dt: 'What it detects',
    explainer_detects_dd:
      'An AI model looks for faces and license plates in each image or video frame. Most of the training data consists of street photos taken in Hamburg, Germany. Results may be less reliable for footage from other regions or different settings.',
    explainer_wrong_dt: 'Why detections can be wrong or missing',
    explainer_wrong_dd:
      'Before scanning, images and frames are scaled down to 1280 pixels, so small objects may not be detected at all. The model can also miss things at unusual angles or in poor light, and occasionally marks something as a face or plate when it is not. Always review the result before sharing. Detection quality is the same across all browsers.',
    explainer_video_dt: 'Video not showing up?',
    explainer_video_dd:
      'Some video formats are not supported by every browser. If a video does not load, try a different browser.',
    explainer_speed_dt: 'Processing speed',
    explainer_speed_dd:
      'Different browsers use different hardware paths for video decoding and AI inference. If processing is slow, trying a different browser may help.',
    explainer_terms_dt: 'Terms of use',
    explainer_terms_dd:
      'The tool may be used free of charge. Using it does not create any obligations. The source code is available at',

    // Dynamic — ETA
    almost_done: 'almost done',
    eta_s: '~{s}s',
    eta_ms: '~{m}m {r}s',

    // Dynamic — detection / copy status
    copied: 'Copied!',
    detecting_plain: 'Detecting\u2026',
    detecting_timed: 'Detecting\u2026 (~{t}s)',

    // Dynamic — file nav / summary
    files_loaded_one: '1 file loaded',
    files_loaded_n: '{n} files loaded',
    selected: '{s} selected',

    // Dynamic — export progress
    wakelock_warning:
      'Could not keep the screen awake. If the screen sleeps during export, the export will fail. Keep the screen active until it finishes.',
    estimating: 'Estimating\u2026',
    done: 'Done',
    failed: 'Failed',
  },

  de: {
    page_title: 'Media Redactor',

    step_load: 'Dateien laden',
    dropzone_text: 'Bilder oder Videos hier ablegen',
    btn_choose_files: 'Dateien ausw\u00e4hlen',
    btn_load_examples: 'Beispiele laden',

    step_preview: 'Vorschau & Schnitt',
    step_redaction: 'Redaktion',
    aria_prev: 'Vorherige Datei',
    aria_file_select: 'Ausgew\u00e4hlte Datei',
    aria_next: 'N\u00e4chste Datei',
    detecting: 'Erkennung\u2026',
    libav_warning: 'Software-Decoder aktiv \u2014 Suchen kann langsam sein',
    trim_label: 'Schnittbereich',
    trim_start: 'Start',
    trim_end: 'Ende',

    step_settings: 'Einstellungen',
    setting_model: 'Erkennungsmodell',
    model_small: 'Schnell \u2014 klein (8\u00a0MB)',
    model_large: 'Genau \u2014 gro\u00df (178\u00a0MB)',
    setting_metadata: 'Metadaten',
    setting_audio: 'Audio',
    keep: 'Behalten',
    metadata_gps: 'Nur GPS',
    strip: 'Entfernen',
    setting_confidence: 'Min. Konfidenz',
    setting_redaction: 'Schw\u00e4rzungsstil',
    naming_pattern: 'Dateiname-Muster',
    naming_col_variable: 'Variable',
    naming_col_desc: 'Beschreibung',
    naming_col_value: 'Wert',
    var_desc_input: 'Originaldateiname (ohne Endung)',
    var_desc_index: 'Position beim Export (1, 2, 3\u2026)',
    var_desc_year: 'Jahr aus Datei-Metadaten',
    var_desc_month: 'Monat (01\u201312)',
    var_desc_day: 'Tag (01\u201331)',
    var_desc_hour: 'Stunde (00\u201323)',
    var_desc_minute: 'Minute (00\u201359)',
    var_desc_timezone: 'UTC-Offset',
    var_desc_lat: 'GPS-Breitengrad',
    var_desc_lon: 'GPS-L\u00e4ngengrad',
    var_desc_duration: 'Videodauer (hh:mm:ss)',
    mode_blur: 'Unsch\u00e4rfe',
    mode_blackout: 'Volltonfarbe',
    mode_pixelate: 'Verpixeln',
    mode_outline: 'Umriss (Debug)',

    step_export: 'Exportieren',
    btn_export: '{name} exportieren',
    btn_export_all: 'Alle exportieren ({n})',
    overall: 'Gesamt',

    step_debug: 'Debug',
    debug_subtitle: 'Alle Konsolenausgaben hier',
    btn_copy: 'In Zwischenablage kopieren',
    btn_clear: 'Leeren',
    btn_delete_detections: 'Erkennungen l\u00f6schen',
    btn_defaults: 'Standardeinstellungen wiederherstellen',
    confirm_delete_detections: 'Alle gespeicherten Erkennungen l\u00f6schen?',

    // Explainer
    explainer_top:
      'Gesichter und Kfz-Kennzeichen in Fotos und Videos werden automatisch unkenntlich gemacht. Die Verarbeitung l\u00e4uft vollst\u00e4ndig im Browser \u2014 Dateien werden nicht \u00fcbertragen. Die Erkennung ist nicht perfekt: Das Ergebnis sollte vor dem Teilen immer gepr\u00fcft werden.',
    explainer_more: 'Mehr erfahren \u2193',
    explainer_mobile_note:
      'Auf einem Desktop oder Laptop l\u00e4sst sich das Tool besser bedienen \u2014 mobile Ger\u00e4te sind in der Regel zu langsam.',
    explainer_h2: 'So funktioniert es',
    explainer_processing_dt: 'Verarbeitung im Browser',
    explainer_processing_dd:
      'Dekodierung, Erkennung und Export laufen als Code im Browser-Tab. Die Dateien werden vom Datentr\u00e4ger in den Arbeitsspeicher des Browsers gelesen und nicht \u00fcber das Netzwerk \u00fcbertragen.',
    explainer_detects_dt: 'Was erkannt wird',
    explainer_detects_dd:
      'Ein KI-Modell durchsucht jedes Bild bzw. jeden Videoframe nach Gesichtern und Kfz-Kennzeichen. Der Gro\u00dfteil der Trainingsdaten besteht aus Stra\u00dfenfotos aus Hamburg. Bei Aufnahmen aus anderen Regionen oder anderen Umgebungen kann die Erkennungsqualit\u00e4t schlechter ausfallen.',
    explainer_wrong_dt: 'Warum Erkennungen fehlen oder falsch sein k\u00f6nnen',
    explainer_wrong_dd:
      'Vor der Analyse werden Bilder und Frames auf 1280 Pixel skaliert, sodass kleine Objekte m\u00f6glicherweise gar nicht erkannt werden. Das Modell kann au\u00dferdem Dinge bei ungew\u00f6hnlichen Blickwinkeln oder schlechtem Licht \u00fcbersehen und gelegentlich etwas als Gesicht oder Kennzeichen markieren, das keines ist. Das Ergebnis sollte immer vor dem Teilen gepr\u00fcft werden. Die Erkennungsqualit\u00e4t ist in allen Browsern gleich.',
    explainer_video_dt: 'Video wird nicht angezeigt?',
    explainer_video_dd:
      'Manche Videoformate werden nicht von jedem Browser unterst\u00fctzt. Wenn ein Video nicht l\u00e4dt, hilft oft ein anderer Browser.',
    explainer_speed_dt: 'Verarbeitungsgeschwindigkeit',
    explainer_speed_dd:
      'Verschiedene Browser nutzen unterschiedliche Hardware-Pfade f\u00fcr Videodekodierung und KI-Inferenz. Bei langsamer Verarbeitung kann ein anderer Browser helfen.',
    explainer_terms_dt: 'Nutzungsbedingungen',
    explainer_terms_dd:
      'Das Tool ist kostenlos nutzbar. Durch die Nutzung entstehen keine Verpflichtungen. Der Quellcode ist verf\u00fcgbar unter',

    almost_done: 'fast fertig',
    eta_s: '~{s}s',
    eta_ms: '~{m}m {r}s',

    copied: 'Kopiert!',
    detecting_plain: 'Erkennung\u2026',
    detecting_timed: 'Erkennung\u2026 (~{t}s)',

    files_loaded_one: '1 Datei geladen',
    files_loaded_n: '{n} Dateien geladen',
    selected: '{s} ausgew\u00e4hlt',

    wakelock_warning:
      'Bildschirm kann nicht aktiv gehalten werden. Wenn der Bildschirm w\u00e4hrend des Exports ausgeht, bricht der Export ab. Bitte den Bildschirm bis zum Abschluss aktiv lassen.',
    estimating: 'Sch\u00e4tzung\u2026',
    done: 'Fertig',
    failed: 'Fehlgeschlagen',
  },
} as const;

type StringKey = keyof typeof STRINGS.en;

/** Look up a translated string. */
export function t(key: StringKey): string {
  return (STRINGS[lang] as Record<string, string>)[key] ?? STRINGS.en[key];
}

/** Look up a translated string and substitute `{placeholder}` variables. */
export function tpl(key: StringKey, vars: Record<string, string | number>): string {
  let s = t(key);
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Translate a model detection label (e.g. 'plate', 'person'). */
const LABEL_DE: Record<string, string> = { plate: 'Kennzeichen', person: 'Person' };
export function translateLabel(label: string): string {
  return lang === 'de' ? (LABEL_DE[label] ?? label) : label;
}

/**
 * Apply translations to the DOM.
 * - Elements with `data-i18n="key"` get their textContent replaced.
 * - Elements with `data-i18n-label="key"` get their aria-label replaced.
 * Call once after DOMContentLoaded.
 */
export function applyTranslations(): void {
  document.title = t('page_title');
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as StringKey);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-label]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nLabel as StringKey));
  }
}
