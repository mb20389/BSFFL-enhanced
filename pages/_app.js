// pages/_app.js
import "../styles/globals.css"; // put your table styles in here

export default function App({ Component, pageProps }) {
  return <Component {...pageProps} />;
}
