import {lazy,Suspense} from 'react';
import {Navigate,Route,Routes} from 'react-router-dom';
import {AuthProvider,useAuth} from './contexts/AuthContext';
import {useGroup} from './hooks/useGroup';
import Layout from './components/Layout';
import AuthPage from './pages/AuthPage';

const HomePage=lazy(()=>import('./pages/HomePage'));
const MatchesPage=lazy(()=>import('./pages/MatchesPage'));
const MatchPage=lazy(()=>import('./pages/MatchPage'));
const AdminPage=lazy(()=>import('./pages/AdminPage'));
const ProfilePage=lazy(()=>import('./pages/ProfilePage'));
const SquadPage=lazy(()=>import('./pages/SquadPage'));
const RatingsPage=lazy(()=>import('./pages/RatingsPage'));
const AvailabilityPage=lazy(()=>import('./pages/AvailabilityPage'));
const ActivityPage=lazy(()=>import('./pages/ActivityPage'));
const HistoryPage=lazy(()=>import('./pages/HistoryPage'));
const StatsPage=lazy(()=>import('./pages/StatsPage'));
const PlayerPage=lazy(()=>import('./pages/PlayerPage'));
const GroupsPage=lazy(()=>import('./pages/GroupsPage'));
const GroupSettingsPage=lazy(()=>import('./pages/GroupSettingsPage'));
const SystemAdminPage=lazy(()=>import('./pages/SystemAdminPage'));
const InvitePage=lazy(()=>import('./pages/InvitePage'));

function Loader({text='טוענים את TEAMUP...'}:{text?:string}){return <div className="app-loader"><div><span/><strong>TEAMUP</strong><p>{text}</p></div></div>}
function RequireGroup({children}:{children:React.ReactNode}){const g=useGroup();if(g.isLoading)return <Loader text="טוענים את הקבוצות שלך..."/>;if(!g.memberships.length)return <Navigate to="/groups" replace/>;return <>{children}</>}
function Router(){const {user,loading}=useAuth();if(loading)return <Loader text="מכינים את המגרש..."/>;if(!user)return <AuthPage/>;return <Suspense fallback={<Loader/>}><Routes><Route path="groups" element={<GroupsPage/>}/><Route path="join/:code" element={<InvitePage/>}/><Route element={<RequireGroup><Layout/></RequireGroup>}><Route index element={<HomePage/>}/><Route path="availability" element={<AvailabilityPage/>}/><Route path="squad" element={<SquadPage/>}/><Route path="players/:id" element={<PlayerPage/>}/><Route path="ratings" element={<RatingsPage/>}/><Route path="stats" element={<StatsPage/>}/><Route path="activity" element={<ActivityPage/>}/><Route path="history" element={<HistoryPage/>}/><Route path="matches" element={<MatchesPage/>}/><Route path="matches/:id" element={<MatchPage/>}/><Route path="admin" element={<AdminPage/>}/><Route path="group-settings" element={<GroupSettingsPage/>}/><Route path="system-admin" element={<SystemAdminPage/>}/><Route path="profile" element={<ProfilePage/>}/></Route><Route path="*" element={<Navigate to="/"/>}/></Routes></Suspense>}
export default function App(){return <AuthProvider><Router/></AuthProvider>}
