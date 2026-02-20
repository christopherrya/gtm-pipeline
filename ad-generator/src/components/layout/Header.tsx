import { Logo } from '@/components/Logo';
import { Badge } from '@/components/ui/badge';

export const Header = () => {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-background border-b border-border flex items-center justify-between px-6">
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
      <Logo className="h-8" />
      <span className="text-sm font-medium text-muted-foreground">Ad Generator</span>
      <Badge variant="secondary">Dev Tool</Badge>
    </header>
  );
};
