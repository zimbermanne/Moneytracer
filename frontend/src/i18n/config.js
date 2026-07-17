import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Import translation files
import en from './locales/en.json';
import sw from './locales/sw.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';

const resources = {
  en: { translation: en },
  sw: { translation: sw },
  fr: { translation: fr },
  ar: { translation: ar },
};

// Languages that read right-to-left. Arabic is the only one in scope today,
// but keeping this as a set makes adding another RTL locale a one-line change.
const RTL_LANGUAGES = new Set(['ar']);

function applyDirection(lng) {
  const dir = RTL_LANGUAGES.has(lng) ? 'rtl' : 'ltr';
  document.documentElement.dir = dir;
  document.documentElement.lang = lng;
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en', // Default language
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React already escapes values
    },
  });

// Set dir/lang on load and on every language change — without this, switching
// to Arabic changes the text but leaves the layout left-to-right.
applyDirection(i18n.language);
i18n.on('languageChanged', applyDirection);

export default i18n;
