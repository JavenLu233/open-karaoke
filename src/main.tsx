import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './components/App';

document.documentElement.style.setProperty(
  '--ambient-cover',
  `url("${import.meta.env.BASE_URL}open-karaoke-cover.png")`,
);

const root = document.getElementById('root');
if (!root) throw new Error('找不到 React 根节点。');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
