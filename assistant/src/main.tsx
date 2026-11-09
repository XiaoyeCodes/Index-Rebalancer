import { createRoot } from 'react-dom/client';
import { Assistant } from './routes/Assistant';
import './theme.css';

createRoot(document.getElementById('root')!).render(<Assistant />);
