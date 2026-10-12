import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import './strategy.css';
import './team.css';
import './battle.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { message: string }> {
  state = { message: '' };
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  render() {
    if (this.state.message) return <div className="startup-error"><h1>暂时无法显示图鉴</h1><p>{this.state.message}</p><button onClick={() => location.reload()}>重新打开</button></div>;
    return this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
