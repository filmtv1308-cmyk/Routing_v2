
declare global {
  interface Window {
    firebase: any;
  }
}

// 🔴 ВСТАВЬ СЮДА ДАННЫЕ ИЗ FIREBASE CONSOLE
const firebaseConfig = {
  apiKey: "ВСТАВЬ_API_KEY_ОТСЮДА",
  authDomain: "ВСТАВЬ_AUTH_DOMAIN_ОТСЮДА",
  projectId: "ВСТАВЬ_PROJECT_ID_ОТСЮДА",
  appId: "ВСТАВЬ_APP_ID_ОТСЮДА",
};

// инициализация Firebase (САМОЕ ВАЖНОЕ)
window.firebase.initializeApp(firebaseConfig);

// экспорт авторизации
export const auth = window.firebase.auth();

// главный администратор
export const ADMIN_EMAIL = "timenkov.sv@yandex.ru";