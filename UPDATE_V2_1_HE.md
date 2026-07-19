# TEAMUP V2.1 – תיקון Realtime

התיקון מחליף את `src/hooks/useRealtime.ts` בלבד.

## התקנה

1. עצור את שרת הפיתוח עם `Ctrl + C`.
2. העתק את תיקיית `src` מתוך העדכון אל תיקיית הפרויקט ואשר החלפה.
3. הפעל מחדש עם `npm run dev`.

אין צורך ב־`npm install` ואין צורך להריץ SQL.

## מה תוקן

- כל חיבור Realtime מקבל שם ערוץ ייחודי.
- כל מאזיני `postgres_changes` נרשמים לפני `subscribe()`.
- בעת פירוק קומפוננטה מתבצע `unsubscribe()` ולאחריו הסרת הערוץ.
- התיקון בטוח גם תחת React Strict Mode שמרכיב Effects פעמיים בסביבת פיתוח.
