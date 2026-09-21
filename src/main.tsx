import React from 'react';import ReactDOM from 'react-dom/client';import {BrowserRouter} from 'react-router-dom';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';import {Toaster} from 'sonner';import App from './App';import ErrorBoundary from './components/ErrorBoundary';import {initializeTheme,ThemeProvider,useTheme} from './contexts/ThemeContext';import './index.css';import './redesign.css';
const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:30000,retry:1,refetchOnWindowFocus:false}}});
initializeTheme();
if('serviceWorker' in navigator){
 if(import.meta.env.PROD)window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>undefined));
 else window.addEventListener('load',async()=>{const registrations=await navigator.serviceWorker.getRegistrations();await Promise.all(registrations.map(registration=>registration.unregister()));if('caches' in window){const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith('teamup-')).map(key=>caches.delete(key)))}});
}
function ThemeToaster(){const {theme}=useTheme();return <Toaster position="top-center" richColors theme={theme}/>}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><ErrorBoundary><App/></ErrorBoundary><ThemeToaster/></BrowserRouter></QueryClientProvider></ThemeProvider></React.StrictMode>)
