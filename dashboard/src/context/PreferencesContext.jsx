import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const PreferencesContext = createContext(null);

const LANGUAGE_STORAGE_KEY = 'dashboard.preferences.language';
const THEME_STORAGE_KEY = 'dashboard.preferences.theme';

const SUPPORTED_LANGUAGES = ['en', 'tr', 'sr'];
const SUPPORTED_THEMES = ['dark', 'light'];

const translations = {
  en: {
    common: {
      online: 'ONLINE',
      offline: 'OFFLINE',
      language: 'Language',
      theme: 'Theme',
      dark: 'Dark',
      light: 'Light',
      close: 'Close',
      user: 'User',
      logout: 'Logout',
      allOk: 'All OK',
      partial: 'Partial',
      unavailable: 'Offline',
    },
    login: {
      title: 'StopFires Monitoring',
      subtitle: 'Fire Detection and Monitoring System',
      operatorId: 'Operator ID',
      accessKey: 'Access Key',
      usernamePlaceholder: 'Enter username',
      authenticate: 'Authenticate',
      authFailed: 'Authentication failed',
      connectionError: 'Connection error. Please try again.',
      securityProtocol: 'SECURITY PROTOCOL ACTIVATED',
    },
    app: {
      health: 'Health',
      detections: 'Detections',
      table: 'Table',
      loadingMap: 'Loading Map',
      loadingHealth: 'Loading Health',
      loadingSettings: 'Loading Settings',
      loadingDetectionDetail: 'Loading Detection Detail',
      loadingHistory: 'Loading History',
      tableFormat: 'Table Format',
      backToLiveMap: 'Back to live map',
      closeTableView: 'Close table view',
      mapTools: 'Map Tools',
      mapStyle: 'Map Style',
      mapLayers: 'Map Layers',
      locationSettings: 'Location Settings',
      homeLocation: 'Home Location',
      responsibleArea: 'Responsible Area (UAE)',
      detectionContext: 'Detection Context',
      unknownTime: 'Unknown Time',
      loadingImage: 'Loading image...',
    },
    mapStyles: {
      dark: 'Dark',
      satellite: 'Satellite',
      streets: 'Streets',
      light: 'Light',
      outdoors: 'Outdoors',
      navNight: 'Navigation Night',
    },
    notifications: {
      unknown: 'Unknown',
      unknownDevice: 'Unknown Device',
      critical: 'CRITICAL',
      detected: 'DETECTED',
      away: 'away',
      dismiss: 'Dismiss notification',
      cropAlt: 'Crop',
    },
    detectionList: {
      activeTransfer: 'ACTIVE TRANSFER',
      chunks: 'chunks',
      viewContext: 'View Context',
      classPlaceholder: 'Class',
      deviceIdPlaceholder: 'Device ID',
      save: 'SAVE',
      cancel: 'CANCEL',
      receiving: 'RECEIVING',
      partial: 'PARTIAL',
      deviceLabel: 'Device',
      edit: 'Edit',
      delete: 'Delete',
      noSignal: 'No Signal',
      clickToViewOnMap: 'Click to view on map',
      viewDetectionOnMap: 'View detection at {lat}, {lng} on map',
      receivingProgress: 'Receiving...',
      detections: 'Detections',
      filterPlaceholder: 'Filter detections...',
      noDetectionsFound: 'No detections found',
      deleteConfirm: 'Are you sure you want to delete this detection ({className})?',
      deleteFailed: 'Failed to delete detection',
    },
    dataTable: {
      receiving: 'RECEIVING',
      fullFrame: 'Full Frame',
      locate: 'LOCATE',
      noSignal: 'No Signal',
      location: 'Location',
      unknownDeviceShort: 'UNK',
      tableFormat: 'Table Format',
      records: 'Records',
      refresh: 'Refresh',
      detectedObjects: 'Detected Objects',
      deviceId: 'Device ID',
      capturedTime: 'Captured Time',
      details: 'Details',
      notAvailable: 'N/A',
      viewDetails: 'View Details',
      deleteRecord: 'Delete Record',
      deleteRecordConfirm: 'Are you sure you want to delete this record and all {count} detections?',
      deleteRecordFailed: 'Failed to delete record',
      updateCropFailed: 'Failed to update crop',
      updateRecordFailed: 'Failed to update record',
    },
  },
  tr: {
    common: {
      online: 'ONLINE',
      offline: 'OFFLINE',
      language: 'Dil',
      theme: 'Tema',
      dark: 'Koyu',
      light: 'Aydınlık',
      close: 'Kapat',
      user: 'Kullanıcı',
      logout: 'Çıkış',
      allOk: 'Tamam',
      partial: 'Kısmi',
      unavailable: 'Çevrimdışı',
    },
    login: {
      title: 'StopFires İzleme',
      subtitle: 'Yangın Tespit ve İzleme Sistemi',
      operatorId: 'Operator ID',
      accessKey: 'Erisim Anahtari',
      usernamePlaceholder: 'Kullanıcı adını girin',
      authenticate: 'Giriş Yap',
      authFailed: 'Kimlik doğrulama başarısız',
      connectionError: 'Bağlantı hatası. Lütfen tekrar deneyin.',
      securityProtocol: 'GUVENLIK PROTOKOLU AKTIF',
    },
    app: {
      health: 'Sağlık',
      detections: 'Tespitler',
      table: 'Tablo',
      loadingMap: 'Harita Yükleniyor',
      loadingHealth: 'Sağlık Verisi Yukleniyor',
      loadingSettings: 'Ayarlar Yükleniyor',
      loadingDetectionDetail: 'Tespit Detayı Yukleniyor',
      loadingHistory: 'Geçmiş Yükleniyor',
      tableFormat: 'Tablo Görünümü',
      backToLiveMap: 'Canlı haritaya dön',
      closeTableView: 'Tabloyu Kapat',
      mapTools: 'Harita Araçları',
      mapStyle: 'Harita Stili',
      mapLayers: 'Harita Katmanları',
      locationSettings: 'Konum Ayarları',
      homeLocation: 'Merkez Konumu',
      responsibleArea: 'Sorumlu Alan ',
      detectionContext: 'Tespit Bağlamı',
      unknownTime: 'Bilinmeyen Zaman',
      loadingImage: 'Görsel yükleniyor...',
    },
    mapStyles: {
      dark: 'Koyu',
      satellite: 'Uydu',
      streets: 'Sokak',
      light: 'Aydınlık',
      outdoors: 'Açık Alan',
      navNight: 'Gece Navigasyon',
    },
    notifications: {
      unknown: 'Bilinmiyor',
      unknownDevice: 'Bilinmeyen Cihaz',
      critical: 'KRİTİK',
      detected: 'TESPİT EDİLDİ',
      away: 'uzakta',
      dismiss: 'Bildirimi kapat',
      cropAlt: 'Kesit',
    },
    detectionList: {
      activeTransfer: 'AKTIF AKTARIM',
      chunks: 'parça',
      viewContext: 'Bağlamı Gör',
      classPlaceholder: 'Sınıf',
      deviceIdPlaceholder: 'Cihaz ID',
      save: 'KAYDET',
      cancel: 'IPTAL',
      receiving: 'ALINIYOR',
      partial: 'EKSİK',
      deviceLabel: 'Cihaz',
      edit: 'Düzenle',
      delete: 'Sil',
      noSignal: 'Sinyal Yok',
      clickToViewOnMap: 'Haritada görmek için tıkla',
      viewDetectionOnMap: 'Haritada {lat}, {lng} tespitini göster',
      receivingProgress: 'Alınıyor...',
      detections: 'Tespitler',
      filterPlaceholder: 'Tespitleri filtrele...',
      noDetectionsFound: 'Tespit bulunamadı',
      deleteConfirm: 'Bu tespiti silmek istediğinize emin misiniz ({className})?',
      deleteFailed: 'Tespit silinemedi',
    },
    dataTable: {
      receiving: 'ALINIYOR',
      fullFrame: 'Tam Kare',
      locate: 'HARİTADA',
      noSignal: 'Sinyal Yok',
      location: 'Konum',
      unknownDeviceShort: 'BİLİNMİYOR',
      tableFormat: 'Tablo Görünümü',
      records: 'Kayıt',
      refresh: 'Yenile',
      detectedObjects: 'Tespit Edilen Nesneler',
      deviceId: 'Cihaz ID',
      capturedTime: 'Yakalama Zamanı',
      details: 'Detay',
      notAvailable: 'YOK',
      viewDetails: 'Detayı Gör',
      deleteRecord: 'Kaydi Sil',
      deleteRecordConfirm: 'Bu kayıt ve tüm {count} tespiti silmek istediğinize emin misiniz?',
      deleteRecordFailed: 'Kayıt silinemedi',
      updateCropFailed: 'Kesit güncellenemedi',
      updateRecordFailed: 'Kayıt güncellenemedi',
    },
  },
  sr: {
    common: {
      online: 'ONLINE',
      offline: 'OFFLINE',
      language: 'Jezik',
      theme: 'Tema',
      dark: 'Tamna',
      light: 'Svetla',
      close: 'Zatvori',
      user: 'Korisnik',
      logout: 'Odjava',
      allOk: 'Sve OK',
      partial: 'Delimicno',
      unavailable: 'Van mreze',
    },
    login: {
      title: 'StopFires Nadzor',
      subtitle: 'Sistem za detekciju i nadzor pozara',
      operatorId: 'Operator ID',
      accessKey: 'Pristupni Kljuc',
      usernamePlaceholder: 'Unesite korisnicko ime',
      authenticate: 'Prijava',
      authFailed: 'Autentikacija nije uspela',
      connectionError: 'Greska u vezi. Pokusajte ponovo.',
      securityProtocol: 'BEZBEDNOSNI PROTOKOL AKTIVAN',
    },
    app: {
      health: 'Zdravlje',
      detections: 'Detekcije',
      table: 'Tabela',
      loadingMap: 'Mapa se ucitava',
      loadingHealth: 'Ucitavanje zdravstvenih podataka',
      loadingSettings: 'Ucitavanje podesavanja',
      loadingDetectionDetail: 'Ucitavanje detalja detekcije',
      loadingHistory: 'Ucitavanje istorije',
      tableFormat: 'Tabela',
      backToLiveMap: 'Nazad na mapu uzivo',
      closeTableView: 'Zatvori tabelu',
      mapTools: 'Alati mape',
      mapStyle: 'Stil mape',
      mapLayers: 'Slojevi mape',
      locationSettings: 'Podesavanja lokacije',
      homeLocation: 'Pocetna lokacija',
      responsibleArea: 'Odgovorna zona (UAE)',
      detectionContext: 'Kontekst detekcije',
      unknownTime: 'Nepoznato vreme',
      loadingImage: 'Ucitavanje slike...',
    },
    mapStyles: {
      dark: 'Tamna',
      satellite: 'Satelit',
      streets: 'Ulice',
      light: 'Svetla',
      outdoors: 'Spoljna',
      navNight: 'Nocna navigacija',
    },
    notifications: {
      unknown: 'Nepoznato',
      unknownDevice: 'Nepoznat uredjaj',
      critical: 'KRITICNO',
      detected: 'DETEKTOVANO',
      away: 'udaljeno',
      dismiss: 'Zatvori obavestenje',
      cropAlt: 'Isecak',
    },
    detectionList: {
      activeTransfer: 'AKTIVAN PRENOS',
      chunks: 'delova',
      viewContext: 'Prikazi kontekst',
      classPlaceholder: 'Klasa',
      deviceIdPlaceholder: 'Uredjaj ID',
      save: 'SACUVAJ',
      cancel: 'ODUSTANI',
      receiving: 'PRIJEM',
      partial: 'DELIMICNO',
      deviceLabel: 'Uredjaj',
      edit: 'Izmeni',
      delete: 'Obrisi',
      noSignal: 'Nema signala',
      clickToViewOnMap: 'Kliknite za prikaz na mapi',
      viewDetectionOnMap: 'Prikazi detekciju na {lat}, {lng} na mapi',
      receivingProgress: 'Prijem...',
      detections: 'Detekcije',
      filterPlaceholder: 'Filtriraj detekcije...',
      noDetectionsFound: 'Nema detekcija',
      deleteConfirm: 'Da li ste sigurni da zelite da obrisete ovu detekciju ({className})?',
      deleteFailed: 'Brisanje detekcije nije uspelo',
    },
    dataTable: {
      receiving: 'PRIJEM',
      fullFrame: 'Puni kadar',
      locate: 'LOKACIJA',
      noSignal: 'Nema signala',
      location: 'Lokacija',
      unknownDeviceShort: 'NEPOZNATO',
      tableFormat: 'Tabela',
      records: 'Zapisi',
      refresh: 'Osvezi',
      detectedObjects: 'Detektovani objekti',
      deviceId: 'Uredjaj ID',
      capturedTime: 'Vreme snimanja',
      details: 'Detalji',
      notAvailable: 'N/A',
      viewDetails: 'Prikazi detalje',
      deleteRecord: 'Obrisi zapis',
      deleteRecordConfirm: 'Da li ste sigurni da zelite da obrisete ovaj zapis i svih {count} detekcija?',
      deleteRecordFailed: 'Brisanje zapisa nije uspelo',
      updateCropFailed: 'Azuriranje isecka nije uspelo',
      updateRecordFailed: 'Azuriranje zapisa nije uspelo',
    },
  },
};

const getNestedValue = (source, path) => {
  if (!source || !path) return undefined;
  const keys = path.split('.');
  let current = source;
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
};

const normalizeLanguage = (value) => {
  const normalized = String(value || '').toLowerCase();
  return SUPPORTED_LANGUAGES.includes(normalized) ? normalized : null;
};

const normalizeTheme = (value) => {
  const normalized = String(value || '').toLowerCase();
  return SUPPORTED_THEMES.includes(normalized) ? normalized : null;
};

export const resolveLanguageFromNavigator = (navigatorLanguage) => {
  const value = String(navigatorLanguage || '').toLowerCase();
  if (value.startsWith('tr')) return 'tr';
  if (value.startsWith('sr')) return 'sr';
  return 'en';
};

export const resolveInitialLanguage = (storedLanguage, navigatorLanguage) => {
  const fromStorage = normalizeLanguage(storedLanguage);
  if (fromStorage) return fromStorage;
  return resolveLanguageFromNavigator(navigatorLanguage);
};

export const resolveInitialTheme = (storedTheme, prefersDark) => {
  const fromStorage = normalizeTheme(storedTheme);
  if (fromStorage) return fromStorage;
  return prefersDark ? 'dark' : 'light';
};

const readStorage = (key) => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeStorage = (key, value) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // noop
  }
};

const detectPrefersDark = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
};

export function PreferencesProvider({ children }) {
  const [language, setLanguage] = useState(() =>
    resolveInitialLanguage(readStorage(LANGUAGE_STORAGE_KEY), typeof navigator !== 'undefined' ? navigator.language : 'en')
  );
  const [theme, setTheme] = useState(() =>
    resolveInitialTheme(readStorage(THEME_STORAGE_KEY), detectPrefersDark())
  );

  useEffect(() => {
    writeStorage(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    writeStorage(THEME_STORAGE_KEY, theme);
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', theme);
    }
  }, [theme]);

  const t = useCallback((key, vars = null) => {
    const activeLanguageStrings = translations[language] || translations.en;
    const template = (
      getNestedValue(activeLanguageStrings, key) ||
      getNestedValue(translations.en, key) ||
      key
    );
    if (!vars || typeof template !== 'string') return template;
    return Object.entries(vars).reduce(
      (acc, [varKey, value]) => acc.replaceAll(`{${varKey}}`, String(value)),
      template
    );
  }, [language]);

  const locale = useMemo(() => {
    if (language === 'tr') return 'tr-TR';
    if (language === 'sr') return 'sr-RS';
    return 'en-US';
  }, [language]);

  const value = useMemo(() => ({
    language,
    setLanguage,
    theme,
    setTheme,
    locale,
    t,
  }), [language, theme, locale, t]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const context = useContext(PreferencesContext);
  if (!context) {
    throw new Error('usePreferences must be used within a PreferencesProvider');
  }
  return context;
}
