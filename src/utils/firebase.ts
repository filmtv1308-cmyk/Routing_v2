declare global {
  interface Window {
    firebase: any;
  }
}

const firebaseConfig = {
  apiKey: "AIzaSyBRiGduv-HbD94-0k1X1zQckdgmV3SXhtQ",
  authDomain: "routes-on-the-map.firebaseapp.com",
  projectId: "routes-on-the-map",
  appId: "1:478985077465:web:332967b3a357f6d295f4c8",
};

// инициализация Firebase
window.firebase.initializeApp(firebaseConfig);

// экспорт авторизации
export const auth = window.firebase.auth();

// главный администратор
export const ADMIN_EMAIL = "timenkov.sv@yandex.ru";