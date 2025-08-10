// pages/_app.js
import "../styles/globals.css"; // this is your global stylesheet

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}

