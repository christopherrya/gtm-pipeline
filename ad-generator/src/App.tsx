import { AdGeneratorProvider, useAdGeneratorContext } from '@/context/AdGeneratorContext';
import { Layout } from '@/components/layout';
import { Sidebar } from '@/components/layout';
import { CopyEditor, AIAssistant, VariantSelector, ImageGenerator } from '@/components/editor';
import { VariantGrid, ExportPanel } from '@/components/preview';
import { Separator } from '@/components/ui/separator';

function AppContent() {
  const ctx = useAdGeneratorContext();

  return (
    <Layout
      sidebar={
        <Sidebar
          selectedTemplates={ctx.selectedTemplates}
          onToggleTemplate={ctx.toggleTemplate}
          formatFilter={ctx.formatFilter}
          onFormatFilterChange={ctx.setFormatFilter}
        />
      }
    >
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Idea + Copy section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold mb-1">Your Ad Angle</h2>
              <p className="text-sm text-muted-foreground mb-3">Describe the idea and AI will write the copy</p>
              <AIAssistant onGenerateCopy={ctx.setCopy} currentCopy={ctx.copy} />
            </div>
            <Separator />
            <div>
              <h2 className="text-lg font-semibold mb-1">Ad Copy</h2>
              <p className="text-sm text-muted-foreground mb-3">AI-generated — edit any field below</p>
              <CopyEditor copy={ctx.copy} onChange={ctx.setCopy} />
            </div>
          </div>
          <div className="space-y-6">
            <ImageGenerator />
            <Separator />
            <VariantSelector
              variantCount={ctx.variantCount}
              onVariantCountChange={ctx.setVariantCount}
              selectedTemplates={ctx.selectedTemplates}
              onToggleTemplate={ctx.toggleTemplate}
              selectedFormats={ctx.selectedFormats}
              onToggleFormat={ctx.toggleFormat}
              onGenerate={ctx.generateVariants}
              imageEnabled={ctx.imageEnabled}
              generatingImages={ctx.generatingImages}
              generatingCopy={ctx.generatingCopy}
            />
          </div>
        </div>

        <Separator />

        {/* Export panel */}
        <ExportPanel />

        {/* Preview grid */}
        <VariantGrid />
      </div>
    </Layout>
  );
}

function App() {
  return (
    <AdGeneratorProvider>
      <AppContent />
    </AdGeneratorProvider>
  );
}

export default App;
