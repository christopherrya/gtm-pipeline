import { Header } from './Header';

interface LayoutProps {
  sidebar: React.ReactNode;
  children: React.ReactNode;
}

export const Layout = ({ sidebar, children }: LayoutProps) => {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <div className="flex pt-16">
        <aside className="fixed left-0 top-16 bottom-0 w-[280px] border-r border-border bg-background overflow-hidden">
          {sidebar}
        </aside>
        <main className="ml-[280px] flex-1 p-6">
          {children}
        </main>
      </div>
    </div>
  );
};
