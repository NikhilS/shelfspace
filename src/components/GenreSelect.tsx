import React, {useState, useEffect} from 'react';
import {
  CANONICAL_PRIMARY_GENRES,
  getSubgenresFor,
  sanitizeGenrePayload,
} from '../constants/taxonomy';
import {Label} from './ui/label';
import {Input} from './ui/input';
import {Button} from './ui/button';
import {Check, X} from 'lucide-react';

export interface GenreSelectProps {
  primaryGenre?: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  onChange: (values: {
    primaryGenre: string;
    subgenres: string[];
    isCustomPrimary: boolean;
  }) => void;
  disabled?: boolean;
  className?: string;
}

export function GenreSelect({
  primaryGenre = '',
  subgenres = [],
  isCustomPrimary = false,
  onChange,
  disabled = false,
  className = '',
}: GenreSelectProps) {
  // Determine if the current primaryGenre is a canonical one or "Other"/custom
  const isCanonical =
    Boolean(primaryGenre) &&
    CANONICAL_PRIMARY_GENRES.includes(
      primaryGenre as (typeof CANONICAL_PRIMARY_GENRES)[number],
    );

  const selectValue = !primaryGenre ? '' : isCanonical ? primaryGenre : 'Other';

  const [customGenreText, setCustomGenreText] = useState(
    isCustomPrimary || (primaryGenre && !isCanonical) ? primaryGenre : '',
  );

  const [customSubgenreInput, setCustomSubgenreInput] = useState('');

  // Keep custom text in sync if incoming prop changes
  useEffect(() => {
    if (
      isCustomPrimary ||
      (primaryGenre && !isCanonical && primaryGenre !== 'Other')
    ) {
      setCustomGenreText(primaryGenre);
    }
  }, [primaryGenre, isCustomPrimary, isCanonical]);

  const availableSubgenres = isCanonical ? getSubgenresFor(primaryGenre) : [];

  const handleSelectPrimary = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (!val) {
      onChange({
        primaryGenre: '',
        subgenres: [],
        isCustomPrimary: false,
      });
      return;
    }

    if (val === 'Other') {
      const sanitized = sanitizeGenrePayload({
        primaryGenre: customGenreText.trim() || 'Other',
        subgenres: isCustomPrimary ? subgenres : [],
        isCustomPrimary: true,
      });
      onChange(sanitized);
    } else {
      const sanitized = sanitizeGenrePayload({
        primaryGenre: val,
        subgenres, // sanitizeGenrePayload automatically retains only valid subgenres for the new primary
        isCustomPrimary: false,
      });
      onChange(sanitized);
    }
  };

  const handleCustomGenreChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setCustomGenreText(text);
    onChange({
      primaryGenre: text.trim() || 'Other',
      subgenres,
      isCustomPrimary: true,
    });
  };

  const toggleSubgenre = (sub: string) => {
    const current = subgenres || [];
    const isPresent = current.includes(sub);

    let next: string[];
    if (isPresent) {
      next = current.filter(s => s !== sub);
    } else {
      if (current.length >= 3) {
        return; // Max 3 reached
      }
      next = [...current, sub];
    }

    const sanitized = sanitizeGenrePayload({
      primaryGenre:
        selectValue === 'Other'
          ? customGenreText.trim() || 'Other'
          : primaryGenre,
      subgenres: next,
      isCustomPrimary: selectValue === 'Other',
    });
    onChange(sanitized);
  };

  const handleAddCustomSubgenre = () => {
    const trimmed = customSubgenreInput.trim();
    if (!trimmed) return;
    if ((subgenres || []).length >= 3) return;
    if ((subgenres || []).includes(trimmed)) return;

    const next = [...(subgenres || []), trimmed];
    setCustomSubgenreInput('');
    onChange({
      primaryGenre:
        selectValue === 'Other'
          ? customGenreText.trim() || 'Other'
          : primaryGenre,
      subgenres: next,
      isCustomPrimary: true,
    });
  };

  const removeSubgenre = (sub: string) => {
    const next = (subgenres || []).filter(s => s !== sub);
    onChange({
      primaryGenre:
        selectValue === 'Other'
          ? customGenreText.trim() || 'Other'
          : primaryGenre,
      subgenres: next,
      isCustomPrimary: selectValue === 'Other',
    });
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Primary Genre Dropdown */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label
            htmlFor="primary-genre-select"
            className="text-xs font-semibold text-ink"
          >
            Primary Genre
          </Label>
          {primaryGenre && (
            <span className="text-[11px] text-on-surface-variant">
              Standardized taxonomy
            </span>
          )}
        </div>
        <select
          id="primary-genre-select"
          value={selectValue}
          onChange={handleSelectPrimary}
          disabled={disabled}
          className="w-full bg-surface-container text-sm h-11 rounded-lg px-3 border border-outline-variant/40 text-on-surface outline-none focus:border-primary transition-colors disabled:opacity-50"
        >
          <option value="">Select Primary Genre...</option>
          {CANONICAL_PRIMARY_GENRES.map(genre => (
            <option key={genre} value={genre}>
              {genre}
            </option>
          ))}
          <option value="Other">Other (Custom Genre)</option>
        </select>
      </div>

      {/* Freeform input if "Other" is chosen */}
      {selectValue === 'Other' && (
        <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
          <Label
            htmlFor="custom-primary-genre-input"
            className="text-xs font-semibold text-ink"
          >
            Custom Genre Name
          </Label>
          <Input
            id="custom-primary-genre-input"
            value={customGenreText}
            onChange={handleCustomGenreChange}
            placeholder="e.g., Paleontology, Urban Lore, Nordic Noir"
            disabled={disabled}
            className="bg-surface-container text-sm h-11 rounded-lg"
          />
        </div>
      )}

      {/* Subgenres Section */}
      {primaryGenre && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold text-ink">
              Subgenres{' '}
              <span className="font-normal text-on-surface-variant/70">
                (Optional, up to 3)
              </span>
            </Label>
            <span className="text-[11px] text-on-surface-variant font-medium">
              {(subgenres || []).length}/3 selected
            </span>
          </div>

          {/* Canonical Subgenres Chips */}
          {isCanonical && availableSubgenres.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-[140px] overflow-y-auto pr-1">
              {availableSubgenres.map(sub => {
                const isSelected = (subgenres || []).includes(sub);
                const isMaxReached =
                  (subgenres || []).length >= 3 && !isSelected;

                return (
                  <Button
                    key={sub}
                    type="button"
                    variant={isSelected ? 'secondary' : 'outline'}
                    disabled={disabled || isMaxReached}
                    className={`h-7 px-2.5 py-1 text-xs font-medium rounded-md select-none transition-all flex items-center gap-1 ${
                      isSelected
                        ? 'bg-primary/15 text-primary border-primary/30 hover:bg-primary/20'
                        : isMaxReached
                          ? 'opacity-40 cursor-not-allowed bg-surface-container border-outline-variant/20'
                          : 'bg-surface-container hover:bg-surface-container-high border-outline-variant/30 text-on-surface'
                    }`}
                    onClick={() => toggleSubgenre(sub)}
                  >
                    {isSelected && <Check className="w-3 h-3 stroke-[2.5]" />}
                    {sub}
                  </Button>
                );
              })}
            </div>
          )}

          {/* Custom Subgenres Input for "Other" */}
          {selectValue === 'Other' && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Input
                  value={customSubgenreInput}
                  onChange={e => setCustomSubgenreInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCustomSubgenre();
                    }
                  }}
                  placeholder="Type a subgenre and press Add"
                  disabled={disabled || (subgenres || []).length >= 3}
                  className="bg-surface-container text-sm h-9 rounded-lg flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddCustomSubgenre}
                  disabled={
                    disabled ||
                    !customSubgenreInput.trim() ||
                    (subgenres || []).length >= 3
                  }
                  className="h-9 px-3"
                >
                  Add
                </Button>
              </div>

              {(subgenres || []).length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(subgenres || []).map(sub => (
                    <span
                      key={sub}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary/10 text-primary border border-primary/20 font-medium"
                    >
                      {sub}
                      <button
                        type="button"
                        onClick={() => removeSubgenre(sub)}
                        disabled={disabled}
                        className="hover:text-primary/70 transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
