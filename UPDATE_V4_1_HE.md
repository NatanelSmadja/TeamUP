# TEAMUP V4.1 – תיקון Realtime

אין צורך להריץ npm install ואין צורך להריץ SQL.

1. עצור את השרת עם Ctrl+C.
2. העתק את תיקיית src מתוך העדכון אל הפרויקט ואשר החלפת קבצים.
3. הפעל npm run dev.

התיקון נותן לכל ערוץ Supabase Realtime שם ייחודי ומסיר אותו בצורה נקייה, ולכן React Strict Mode לא מנסה להוסיף callbacks לערוץ שכבר נרשם.
