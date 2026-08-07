import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Import your new translation files
import en from './locales/en.json';
import fr from './locales/fr.json';
import pt from './locales/pt.json';
import sw from './locales/sw.json';
import ar from './locales/ar.json';  // Arabic
import ha from './locales/ha.json';  // Hausa
import am from './locales/am.json';  // Amharic

const resources = {
  en: { translation: en },
  fr: { translation: fr },
  pt: { translation: pt },
  sw: { translation: sw },
  ar: { translation: ar },
  ha: { translation: ha },
  am: { translation: am },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr', 'pt', 'sw', 'ar', 'ha', 'am'],
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;