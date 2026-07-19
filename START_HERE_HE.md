# מתחילים מכאן

1. פתח פרויקט Supabase חדש.
2. ב-SQL Editor הדבק והריץ את כל הקובץ `supabase/migrations/001_initial.sql`.
3. ב-Supabase: Authentication > Providers > Email. אפשר לבטל זמנית Confirm email בזמן בדיקות.
4. העתק `.env.example` לקובץ `.env.local` והכנס Project URL ו-Anon/Public Key.
5. פתח טרמינל בתיקייה והריץ `npm install` ואז `npm run dev`.
6. המשתמש הראשון שנרשם נהיה Admin ונוצרת לו קבוצה. כל משתמש נוסף מצטרף אוטומטית כשחקן לקבוצה הראשונה.
7. ל-Vercel: העלה ל-GitHub, בצע Import, והוסף את שני משתני הסביבה מה-.env.

## מה כלול
הרשמה והתחברות שנשמרת, פרופיל, קבוצה, תפקידי שחקן/Moderator/Admin, יצירת משחק, הרשמה/לא יכול, 15 ראשונים ורשימת המתנה, קידום אוטומטי, יצירת קבוצות, בסיס דירוגים ו-MVP במסד הנתונים, התראות, Audit ו-RLS.
