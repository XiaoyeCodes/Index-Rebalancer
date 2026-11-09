import { createRoot } from 'react-dom/client';
import { Assistant } from './routes/Assistant';
import './theme.css';

if (window === window.parent) {
  location.replace(new URL('../../#assistant', location.href).href);
} else if (window.parent.location.origin === location.origin && window.parent.document.querySelector('#assistantFrame') === window.frameElement) {
  createRoot(document.getElementById('root')!).render(<Assistant />);
}
