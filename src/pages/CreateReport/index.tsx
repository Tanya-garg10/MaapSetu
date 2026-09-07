import React, { useEffect } from 'react';
import { Outlet, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { ArrowRight, ArrowLeft, Check } from 'lucide-react';
import { useAppStore } from '@/lib/store';

const steps = [
  { id: 1, name: 'General', short: 'General', path: '/reports/new/general' },
  { id: 2, name: 'Specs', short: 'Specs', path: '/reports/new/instrument' },
  { id: 3, name: 'Conditions', short: 'Conditions', path: '/reports/new/conditions' },
  { id: 4, name: 'Tests', short: 'Tests', path: '/reports/new/tests' },
  { id: 5, name: 'Review', short: 'Review', path: '/reports/new/review' },
];

export function CreateReportLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const rawReportId = searchParams.get('id');
  const reportId = (rawReportId && rawReportId !== 'undefined' && rawReportId !== 'null') ? rawReportId : null;
  const { setCurrentReportId, updateReportData, updateTestResults, currentReportId } = useAppStore();

  const validReportId = (currentReportId && currentReportId !== 'undefined' && currentReportId !== 'null') ? currentReportId : null;

  useEffect(() => {
    if (reportId) {
      setCurrentReportId(reportId);
      fetch(`/api/reports/${reportId}`)
        .then(res => {
          if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
          return res.json();
        })
        .then(data => {
          if (data && !data.error) {
            updateReportData(data);
            updateTestResults(data.testResults || []);
          }
        })
        .catch(err => console.error('Error loading report:', err));
    } else {
      setCurrentReportId(null);
      updateReportData({});
      updateTestResults([]);
    }
  }, [reportId]);

  const currentStepIndex = steps.findIndex(s => location.pathname.includes(s.path));
  const activeStep = currentStepIndex >= 0 ? currentStepIndex : 0;

  const handleNext = async () => {
    if (activeStep === 0 && !validReportId) {
      const data = useAppStore.getState().reportData;
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, status: 'Draft' }),
      });
      const newReport = await res.json();
      const newId = newReport._id || newReport.id;
      if (newId) {
        setCurrentReportId(newId);
        navigate(steps[activeStep + 1].path + `?id=${newId}`);
      }
      return;
    }

    if (activeStep === steps.length - 1) {
      if (!validReportId) return;
      try {
        await fetch(`/api/reports/${validReportId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'Completed' }),
        });
        navigate('/reports');
      } catch (err) {
        console.error('Execute error', err);
      }
      return;
    }

    if (activeStep < steps.length - 1) {
      navigate(steps[activeStep + 1].path + (validReportId ? `?id=${validReportId}` : ''));
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      navigate(steps[activeStep - 1].path + (validReportId ? `?id=${validReportId}` : ''));
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="flex flex-col h-full bg-warm-ivory">
      {/* ── Step Header ─────────────────────────────── */}
      <div className="bg-white/90 backdrop-blur-md border-b border-near-black/8 px-5 py-3.5">
        <div className="max-w-screen-2xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-4">

          {/* Step indicators */}
          <div className="flex items-center gap-0 overflow-x-auto no-scrollbar">
            {steps.map((step, idx) => {
              const isActive = idx === activeStep;
              const isCompleted = idx < activeStep;
              return (
                <React.Fragment key={step.id}>
                  <button
                    onClick={() => navigate(step.path + (validReportId ? `?id=${validReportId}` : ''))}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap',
                      isActive
                        ? 'bg-near-black text-warm-ivory'
                        : isCompleted
                          ? 'text-emerald hover:bg-emerald/8'
                          : 'text-near-black/35 hover:text-near-black/60 cursor-default'
                    )}
                    disabled={!isCompleted && !isActive}
                  >
                    <span className={cn(
                      'h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                      isActive ? 'bg-electric-lime text-near-black' : isCompleted ? 'bg-emerald/15 text-emerald' : 'bg-near-black/8 text-near-black/35'
                    )}>
                      {isCompleted ? <Check className="h-3 w-3" /> : step.id}
                    </span>
                    <span className="hidden sm:inline">{step.name}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <div className={cn('w-6 h-px mx-1 shrink-0', idx < activeStep ? 'bg-emerald/30' : 'bg-near-black/10')} />
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" size="sm" onClick={handleBack}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <Button size="sm" onClick={handleNext}>
              {activeStep === steps.length - 1 ? 'Finalize Report' : 'Continue'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* ── Step Content ─────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
