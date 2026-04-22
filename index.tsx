
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Monkey-patch JSON.parse to prevent "Uncaught SyntaxError: 'undefined' is not valid JSON"
// that might be coming from an external library or extension.
const originalJSONParse = JSON.parse;
JSON.parse = function (text, reviver) {
  if (text === 'undefined') {
    console.warn("[MonkeyPatch] Intercepted JSON.parse('undefined'). Returning undefined to prevent crash.");
    return undefined;
  }
  return originalJSONParse(text, reviver);
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
