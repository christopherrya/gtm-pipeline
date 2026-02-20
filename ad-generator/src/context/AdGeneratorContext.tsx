import { createContext, useContext } from 'react';
import { useAdGenerator } from '@/hooks/useAdGenerator';

type AdGeneratorContextType = ReturnType<typeof useAdGenerator>;

const AdGeneratorContext = createContext<AdGeneratorContextType | null>(null);

export function AdGeneratorProvider({ children }: { children: React.ReactNode }) {
  const value = useAdGenerator();
  return (
    <AdGeneratorContext.Provider value={value}>
      {children}
    </AdGeneratorContext.Provider>
  );
}

export function useAdGeneratorContext() {
  const ctx = useContext(AdGeneratorContext);
  if (!ctx) throw new Error('useAdGeneratorContext must be used within AdGeneratorProvider');
  return ctx;
}
