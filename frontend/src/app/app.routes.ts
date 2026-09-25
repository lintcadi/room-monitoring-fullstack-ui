import { Routes } from '@angular/router';
import { LiveDashboard } from './live/live-dashboard';

export const routes: Routes = [
  { path: '', component: LiveDashboard, title: 'Live overview · Room monitor' },
  {
    path: 'history',
    loadComponent: () => import('./history/history-page').then((m) => m.HistoryPage),
    title: 'History · Room monitor',
  },
  {
    path: 'cctv',
    loadComponent: () => import('./cctv/cctv-page').then((m) => m.CctvPage),
    title: 'CCTV demo · Room monitor',
  },
  { path: '**', redirectTo: '' },
];
