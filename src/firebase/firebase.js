// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyB2Opj8GuzXoAiJIVn28_d0xi4NQVaTwyw",
  authDomain: "peerlytics.firebaseapp.com",
  projectId: "peerlytics",
  storageBucket: "peerlytics.firebasestorage.app",
  messagingSenderId: "433241625149",
  appId: "1:433241625149:web:cc26fb0d5032e2b2b69054",
  measurementId: "G-89B6YS2NPE"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);