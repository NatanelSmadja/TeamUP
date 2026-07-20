# TEAMUP V3 SaaS Foundation

העדכון הופך את המערכת לפלטפורמה רב־קבוצתית מלאה ללא תשלומים ותוכניות שימוש.

## התקנה
1. גיבוי ו־commit לפני העדכון.
2. העתקת `src` ו־`supabase` לפרויקט.
3. הרצת `supabase/migrations/013_saas_foundation.sql` ב־Supabase SQL Editor.
4. הפעלה עם `npm run dev` ובדיקת שני משתמשים ושתי קבוצות.

## כלול
- Owner / Manager / Player / System Admin
- קבוצות ציבוריות ופרטיות
- הצטרפות פתוחה, אישור מנהל או הזמנה בלבד
- קישור וקוד הזמנה עם אפשרות החלפה
- העברת בעלות
- ארכוב ושחזור
- Audit Log
- System Admin dashboard
- אינדקסים למסד
- Lazy Loading למסכים
- Dashboard סיכום קבוצה
- Pagination בפאנל המערכת

אין צורך ב־npm install ואין שינוי במשתני הסביבה.
