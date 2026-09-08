import './styles.css';
import { PlayerApp } from './app';

document.documentElement.style.setProperty(
  '--ambient-cover',
  `url("${import.meta.env.BASE_URL}open-karaoke-cover.png")`,
);

function bootstrap(): void {
  new PlayerApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
