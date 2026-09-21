import {Navigate} from 'react-router-dom';

export default function HistoryPage() {
  return <Navigate to="/matches?view=past" replace/>;
}
