import {Moon, Sun} from 'lucide-react';
import {useTheme} from '../contexts/ThemeContext';

export default function ThemeToggle({inline = false}: {inline?: boolean}) {
  const {theme, toggleTheme} = useTheme();
  const dark = theme === 'dark';

  return (
    <button
      type="button"
      className={`theme-toggle${inline ? ' inline' : ''}`}
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label={dark ? 'מעבר למצב יום' : 'מעבר למצב כהה'}
      title={dark ? 'מצב יום' : 'מצב כהה'}
    >
      {dark ? <Sun size={18}/> : <Moon size={18}/>}
      <span>{dark ? 'מצב יום' : 'מצב כהה'}</span>
    </button>
  );
}
