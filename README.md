# GolTime Squad

אפליקציית Mobile First לניהול קבוצת כדורגל: הרשמה, רשימת המתנה, הרשאות, ערבוב קבוצות, דירוגים ו-MVP.

## התקנה מקומית
1. צור פרויקט חדש ב-Supabase.
2. פתח SQL Editor והריץ את `supabase/migrations/001_initial.sql`.
3. העתק `.env.example` ל-`.env.local` והכנס URL ו-Anon Key.
4. הרץ `npm install` ואז `npm run dev`.
5. הירשם עם המשתמש הראשון. ה-SQL יוצר קבוצה ראשונית והופך את המשתמש הראשון ל-Admin.

## העלאה ל-Vercel
1. העלה את התיקייה ל-GitHub.
2. ב-Vercel בחר Import Project.
3. Framework: Vite, Build: `npm run build`, Output: `dist`.
4. הוסף Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
5. ב-Supabase Auth > URL Configuration הוסף את כתובת Vercel ל-Site URL ול-Redirect URLs.

## הערות
- אין להכניס Service Role Key לקוד או ל-Vercel בצד לקוח.
- כל הטבלאות מוגנות ב-RLS.
- פונקציות SQL מטפלות בהרשמה אטומית וקידום מרשימת המתנה.
