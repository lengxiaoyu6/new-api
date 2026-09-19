import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ru from './locales/ru.json'
import vi from './locales/vi.json'
import zhTW from './locales/zh-TW.json'
import zh from './locales/zh.json'

i18next.on('languageChanged', (language) => {
  document.documentElement.lang = language
})

const initialization = i18next
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
      'zh-TW': { translation: zhTW },
      fr: { translation: fr },
      ru: { translation: ru },
      ja: { translation: ja },
      vi: { translation: vi },
    },
    fallbackLng: 'zh',
    supportedLngs: ['en', 'zh', 'zh-TW', 'fr', 'ru', 'ja', 'vi'],
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'appica.language',
    },
  })

export default initialization
