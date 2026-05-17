/**
 * Minimal i18n — English and German UI strings.
 * Debug/console log strings are intentionally left in English throughout the codebase.
 *
 * Language selection: use German when the browser's first preferred language starts
 * with "de", otherwise fall back to English.
 */

export type Lang = 'en' | 'de';

export const lang: Lang = (() => {
  const first = (navigator.languages?.[0] ?? navigator.language ?? '').toLowerCase();
  return first.startsWith('de') ? 'de' : 'en';
})();

const STRINGS = {
  en: {
    // Page
    page_title: 'Media Redactor',

    // Step 1 — Load
    step_load:        'Load files',
    dropzone_text:    'Drop images or videos here',
    btn_choose_files: 'Choose files',

    // Step 2 — Preview & trim
    step_preview:    'Preview & trim',
    aria_prev:       'Previous file',
    aria_file_select:'Selected file',
    aria_next:       'Next file',
    detecting:       'Detecting\u2026',
    libav_warning:   'Software decoder active \u2014 seeking may be slow',
    trim_label:      'Trim range',
    trim_start:      'Start',
    trim_end:        'End',

    // Step 3 — Settings
    step_settings:    'Settings',
    setting_model:    'Detection model',
    model_small:      'Small \u2014 fast (8\u00a0MB)',
    model_large:      'Large \u2014 accurate (177\u00a0MB)',
    setting_metadata: 'Metadata',
    setting_audio:    'Audio',
    keep:             'Keep',
    strip:            'Strip',
    setting_redaction:'Redaction style',
    mode_blur:        'Blur',
    mode_blackout:    'Blackout',
    mode_outline:     'Outline (debug)',

    // Step 4 — Export
    step_export:     'Export',
    btn_export:      'Export current file',
    btn_export_all:  'Export all files',
    overall:         'Overall',

    // Step 5 — Debug
    step_debug:      'Debug log',
    debug_subtitle:  'All console output captured here',
    btn_copy:               'Copy to clipboard',
    btn_clear:              'Clear',
    btn_delete_detections:    'Delete detections',
    confirm_delete_detections:'Delete all cached detections?',

    // Dynamic — ETA
    almost_done: 'almost done',
    eta_s:       '~{s}s',
    eta_ms:      '~{m}m {r}s',

    // Dynamic — detection status
    copied:           'Copied!',
    detecting_plain:  'Detecting\u2026',
    detecting_timed:  'Detecting\u2026 (~{t}s)',
    computing:          'computing\u2026',
    downloading_model:  'downloading model\u2026',
    no_detections:    '0 detections',

    // Dynamic — file nav / summary
    files_loaded_one: '1 file loaded',
    files_loaded_n:   '{n} files loaded',
    selected:         '{s} selected',

    // Dynamic — model loading
    loading_model:        'Loading model\u2026',
    loading_chunks_start: 'Loading chunks (0/{total})\u2026',
    loading_chunks:       'Loading chunks ({done}/{total})\u2026',

    // Dynamic — export progress
    wakelock_warning: 'Could not keep the screen awake. If the screen sleeps during export, the export will fail. Keep the screen active until it finishes.',
    estimating: 'Estimating\u2026',
    done:       'Done',
    failed:     'Failed',
  },

  de: {
    page_title: 'Media Redactor',

    step_load:        'Dateien laden',
    dropzone_text:    'Bilder oder Videos hier ablegen',
    btn_choose_files: 'Dateien ausw\u00e4hlen',

    step_preview:    'Vorschau & Schnitt',
    aria_prev:       'Vorherige Datei',
    aria_file_select:'Ausgew\u00e4hlte Datei',
    aria_next:       'N\u00e4chste Datei',
    detecting:       'Erkennung\u2026',
    libav_warning:   'Software-Decoder aktiv \u2014 Suchen kann langsam sein',
    trim_label:      'Schnittbereich',
    trim_start:      'Start',
    trim_end:        'Ende',

    step_settings:    'Einstellungen',
    setting_model:    'Erkennungsmodell',
    model_small:      'Klein \u2014 schnell (8\u00a0MB)',
    model_large:      'Gro\u00df \u2014 genau (177\u00a0MB)',
    setting_metadata: 'Metadaten',
    setting_audio:    'Audio',
    keep:             'Behalten',
    strip:            'Entfernen',
    setting_redaction:'Schw\u00e4rzungsstil',
    mode_blur:        'Unsch\u00e4rfe',
    mode_blackout:    'Schw\u00e4rzen',
    mode_outline:     'Umriss (Debug)',

    step_export:     'Exportieren',
    btn_export:      'Aktuelle Datei exportieren',
    btn_export_all:  'Alle Dateien exportieren',
    overall:         'Gesamt',

    step_debug:     'Debug-Protokoll',
    debug_subtitle: 'Alle Konsolenausgaben hier',
    btn_copy:               'In Zwischenablage kopieren',
    btn_clear:              'Leeren',
    btn_delete_detections:    'Erkennungen l\u00f6schen',
    confirm_delete_detections:'Alle gespeicherten Erkennungen l\u00f6schen?',

    almost_done: 'fast fertig',
    eta_s:       '~{s}s',
    eta_ms:      '~{m}m {r}s',

    copied:           'Kopiert!',
    detecting_plain:  'Erkennung\u2026',
    detecting_timed:  'Erkennung\u2026 (~{t}s)',
    computing:          'Berechnung\u2026',
    downloading_model:  'Modell wird geladen\u2026',
    no_detections:    '0 Erkennungen',

    files_loaded_one: '1 Datei geladen',
    files_loaded_n:   '{n} Dateien geladen',
    selected:         '{s} ausgew\u00e4hlt',

    loading_model:        'Modell laden\u2026',
    loading_chunks_start: 'Segmente laden (0/{total})\u2026',
    loading_chunks:       'Segmente laden ({done}/{total})\u2026',

    wakelock_warning: 'Bildschirm kann nicht aktiv gehalten werden. Wenn der Bildschirm w\u00e4hrend des Exports ausgeht, bricht der Export ab. Bitte den Bildschirm bis zum Abschluss aktiv lassen.',
    estimating: 'Sch\u00e4tzung\u2026',
    done:       'Fertig',
    failed:     'Fehlgeschlagen',
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
