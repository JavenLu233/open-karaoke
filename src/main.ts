import './styles.css';
import { PlayerApp } from './app';

function bootstrap(): void {
  new PlayerApp();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
