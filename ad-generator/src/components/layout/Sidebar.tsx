import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TEMPLATES } from '@/lib/constants';
import type { TemplateId, TemplateConfig } from '@/types/ad';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface SidebarProps {
  selectedTemplates: TemplateId[];
  onToggleTemplate: (id: TemplateId) => void;
  formatFilter: string;
  onFormatFilterChange: (val: string) => void;
}

const TemplateCard = ({
  template,
  selected,
  onToggle,
}: {
  template: TemplateConfig;
  selected: boolean;
  onToggle: () => void;
}) => {
  return (
    <button
      onClick={onToggle}
      className={cn(
        'relative w-full rounded-lg border-2 p-3 text-left transition-all hover:shadow-sm',
        selected
          ? 'border-amber-400 bg-amber-50 shadow-sm'
          : 'border-transparent bg-muted/50 hover:border-border'
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold',
            selected
              ? 'bg-amber-400 text-white'
              : 'bg-muted text-muted-foreground'
          )}
        >
          {template.thumbnail}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{template.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground leading-snug">
            {template.description}
          </p>
        </div>
      </div>
      {selected && (
        <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </div>
      )}
    </button>
  );
};

const TemplateGrid = ({
  templates,
  selectedTemplates,
  onToggleTemplate,
}: {
  templates: TemplateConfig[];
  selectedTemplates: TemplateId[];
  onToggleTemplate: (id: TemplateId) => void;
}) => {
  return (
    <div className="flex flex-col gap-2">
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          template={template}
          selected={selectedTemplates.includes(template.id)}
          onToggle={() => onToggleTemplate(template.id)}
        />
      ))}
    </div>
  );
};

export const Sidebar = ({
  selectedTemplates,
  onToggleTemplate,
  formatFilter,
  onFormatFilterChange,
}: SidebarProps) => {
  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Templates</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {selectedTemplates.length} of {TEMPLATES.length} selected
        </p>
      </div>

      <Tabs value={formatFilter} onValueChange={onFormatFilterChange} className="px-4 pt-3">
        <TabsList className="w-full">
          <TabsTrigger value="all" className="flex-1 text-xs">All</TabsTrigger>
          <TabsTrigger value="square" className="flex-1 text-xs">Square</TabsTrigger>
          <TabsTrigger value="landscape" className="flex-1 text-xs">Land.</TabsTrigger>
          <TabsTrigger value="story" className="flex-1 text-xs">Story</TabsTrigger>
        </TabsList>

        <ScrollArea className="mt-3 h-[calc(100vh-220px)]">
          <TabsContent value="all" className="mt-0">
            <TemplateGrid
              templates={TEMPLATES}
              selectedTemplates={selectedTemplates}
              onToggleTemplate={onToggleTemplate}
            />
          </TabsContent>
          <TabsContent value="square" className="mt-0">
            <TemplateGrid
              templates={TEMPLATES}
              selectedTemplates={selectedTemplates}
              onToggleTemplate={onToggleTemplate}
            />
          </TabsContent>
          <TabsContent value="landscape" className="mt-0">
            <TemplateGrid
              templates={TEMPLATES}
              selectedTemplates={selectedTemplates}
              onToggleTemplate={onToggleTemplate}
            />
          </TabsContent>
          <TabsContent value="story" className="mt-0">
            <TemplateGrid
              templates={TEMPLATES}
              selectedTemplates={selectedTemplates}
              onToggleTemplate={onToggleTemplate}
            />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
};
