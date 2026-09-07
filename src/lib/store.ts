import { create } from 'zustand';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'lab_manager' | 'test_officer' | 'reviewer';
}

interface AppState {
  // Auth
  user: User | null;
  setUser: (user: User | null) => void;

  // Current report being created/edited
  currentReportId: string | null;
  setCurrentReportId: (id: string | null) => void;

  reportData: any;
  updateReportData: (data: any) => void;
  clearReportData: () => void;

  testResults: any[];
  updateTestResults: (results: any[]) => void;

  // Dashboard refresh trigger
  dashboardKey: number;
  refreshDashboard: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  currentReportId: null,
  setCurrentReportId: (id) => set({ currentReportId: (id && id !== 'undefined' && id !== 'null') ? id : null }),

  reportData: {},
  updateReportData: (data) =>
    set((state) => ({ reportData: { ...state.reportData, ...data } })),
  clearReportData: () => set({ reportData: {}, currentReportId: null, testResults: [] }),

  testResults: [],
  updateTestResults: (results) => set({ testResults: results }),

  dashboardKey: 0,
  refreshDashboard: () => set((state) => ({ dashboardKey: state.dashboardKey + 1 })),
}));
