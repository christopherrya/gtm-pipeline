import { useAdGeneratorContext } from '@/context/AdGeneratorContext';
import { AdPreview } from './AdPreview';

export const VariantGrid = () => {
  const { variants, toggleVariant, toggleVariantLayout, regenerateVariantImage, overlayOpacity } = useAdGeneratorContext();
  const enabledCount = variants.filter(v => v.enabled).length;

  if (variants.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center">
          <p className="text-lg font-medium">No variants generated yet</p>
          <p className="text-sm mt-1">Select templates and formats, then click "Generate All Variants"</p>
        </div>
      </div>
    );
  }

  // Group by copy variant index
  const groups = new Map<number, typeof variants>();
  for (const v of variants) {
    const idx = v.copyVariantIndex ?? 0;
    if (!groups.has(idx)) groups.set(idx, []);
    groups.get(idx)!.push(v);
  }

  const sortedGroups = [...groups.entries()].sort((a, b) => a[0] - b[0]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          Preview ({enabledCount}/{variants.length} enabled)
        </h2>
      </div>
      <div className="space-y-8">
        {sortedGroups.map(([copyIdx, groupVariants]) => (
          <div key={copyIdx}>
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Copy Variant {copyIdx + 1}
              </h3>
              <span className="text-xs text-muted-foreground/60 truncate max-w-md">
                "{groupVariants[0]?.copy.headline}"
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
              {groupVariants.map(variant => (
                <AdPreview
                  key={variant.id}
                  variant={variant}
                  onToggle={toggleVariant}
                  onToggleLayout={toggleVariantLayout}
                  onRegenerateImage={regenerateVariantImage}
                  overlayOpacity={overlayOpacity}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
