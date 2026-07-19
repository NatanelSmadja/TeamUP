import React from 'react';
import {AlertTriangle,RefreshCcw} from 'lucide-react';

export default class ErrorBoundary extends React.Component<React.PropsWithChildren,{hasError:boolean}> {
  state={hasError:false};
  static getDerivedStateFromError(){return {hasError:true}}
  componentDidCatch(error:unknown){console.error('TEAMUP UI error',error)}
  render(){
    if(this.state.hasError)return <div className="fatal-error"><AlertTriangle size={36}/><h1>משהו לא נטען כמו שצריך</h1><p>המידע שלך שמור. אפשר לרענן ולנסות שוב.</p><button onClick={()=>window.location.reload()}><RefreshCcw size={18}/>רענון האפליקציה</button></div>;
    return this.props.children;
  }
}
