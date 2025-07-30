import { useState } from 'react';
import { createDynamicCssColor, styled } from 'vindur';
import { DemoSection } from '../components/MainLayout';

// Generate systematic HSL color grid similar to reference image
function generateColorGrid(
  hueSteps: number,
  saturationLevels: number[],
  lightnessLevels: number[],
  includeGrayscale: boolean = true,
) {
  const colors = [];

  // Grayscale row (top)
  if (includeGrayscale) {
    for (let l = 0; l <= 100; l += 100 / (hueSteps - 1)) {
      colors.push(`hsl(0, 0%, ${Math.round(l)}%)`);
    }
  }

  // Color spectrum rows
  for (let satIndex = 0; satIndex < saturationLevels.length; satIndex++) {
    const saturation = saturationLevels[satIndex];

    for (
      let lightIndex = 0;
      lightIndex < lightnessLevels.length;
      lightIndex++
    ) {
      const lightness = lightnessLevels[lightIndex];

      for (let h = 0; h < 360; h += 360 / hueSteps) {
        colors.push(`hsl(${Math.round(h)}, ${saturation}%, ${lightness}%)`);
      }
    }
  }

  return colors;
}

const dynamicColor = createDynamicCssColor();

const GridContainer = styled.div`
  display: grid;
  gap: 2px;
  margin-top: 20px;
  max-width: 100%;
  grid-template-columns: repeat(var(--grid-columns, 12), 1fr);
`;

const ColorCard = styled.div`
  padding: 4px;
  border-radius: 3px;
  text-align: center;
  background: ${dynamicColor.var};
  color: ${dynamicColor.contrast.var};
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 2px;
  font-size: 8px;
  font-weight: 600;
  position: relative;

  &:hover {
    z-index: 10;
    transform: scale(1.5);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
`;

const ColorInfo = styled.div`
  font-size: 6px;
  opacity: 0.9;
  font-family: monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;

const ContrastValue = styled.div`
  font-size: 7px;
  font-weight: bold;
  padding: 1px 2px;
  border-radius: 2px;
  background: ${dynamicColor.contrast.var};
  color: ${dynamicColor.var};
  margin-top: 1px;
  white-space: nowrap;
`;

const OptimalContrastCard = styled.div`
  padding: 4px;
  border-radius: 3px;
  text-align: center;
  background: ${dynamicColor.var};
  color: ${dynamicColor.contrast.optimal()};
  border: 1px solid #4ecdc4;
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 2px;
  font-size: 8px;
  font-weight: 600;
  position: relative;

  &:hover {
    z-index: 10;
    transform: scale(1.5);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
`;

const Controls = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  align-items: start;
  margin-bottom: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
`;

const ControlGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const Label = styled.label`
  color: white;
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SliderInput = styled.input`
  width: 100%;
  margin: 4px 0;
`;

const NumberInput = styled.input`
  width: 60px;
  padding: 4px 8px;
  border: 1px solid #666;
  border-radius: 4px;
  background: #2a2a2a;
  color: white;
  font-size: 12px;
`;

const ToggleButton = styled.button`
  padding: 8px 16px;
  border: 2px solid #4ecdc4;
  background: transparent;
  color: #4ecdc4;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;

  &.active {
    background: #4ecdc4;
    color: #000;
  }
`;

export function ContrastTestDemo() {
  const [showOptimal, setShowOptimal] = useState(false);
  const [hueSteps, setHueSteps] = useState(12);
  const [saturationLevels, setSaturationLevels] = useState([
    90, 75, 60, 45, 30,
  ]);
  const [lightnessLevels, setLightnessLevels] = useState([20, 35, 50, 65, 80]);
  const [includeGrayscale, setIncludeGrayscale] = useState(true);

  const testColors = generateColorGrid(
    hueSteps,
    saturationLevels,
    lightnessLevels,
    includeGrayscale,
  );

  return (
    <DemoSection title="Contrast Test">
      <Controls>
        <ControlGroup>
          <Label>
            <input
              type="checkbox"
              checked={showOptimal}
              onChange={(e) => setShowOptimal(e.target.checked)}
            />
            Show Optimal Contrast
          </Label>

          <Label>
            <input
              type="checkbox"
              checked={includeGrayscale}
              onChange={(e) => setIncludeGrayscale(e.target.checked)}
            />
            Include Grayscale Row
          </Label>
        </ControlGroup>

        <ControlGroup>
          <Label>
            Hue Steps: {hueSteps}
            <NumberInput
              type="number"
              min="6"
              max="24"
              value={hueSteps}
              onChange={(e) => setHueSteps(parseInt(e.target.value) || 12)}
            />
          </Label>
          <SliderInput
            type="range"
            min="6"
            max="24"
            value={hueSteps}
            onChange={(e) => setHueSteps(parseInt(e.target.value))}
          />
        </ControlGroup>

        <ControlGroup>
          <Label>Saturation Levels:</Label>
          <div
            css={`
              display: flex;
              gap: 4px;
              flex-wrap: wrap;
            `}
          >
            {saturationLevels.map((level, index) => (
              <NumberInput
                key={index}
                type="number"
                min="0"
                max="100"
                value={level}
                onChange={(e) => {
                  const newLevels = [...saturationLevels];
                  newLevels[index] = parseInt(e.target.value) || 0;
                  setSaturationLevels(newLevels);
                }}
              />
            ))}
          </div>
        </ControlGroup>

        <ControlGroup>
          <Label>Lightness Levels:</Label>
          <div
            css={`
              display: flex;
              gap: 4px;
              flex-wrap: wrap;
            `}
          >
            {lightnessLevels.map((level, index) => (
              <NumberInput
                key={index}
                type="number"
                min="0"
                max="100"
                value={level}
                onChange={(e) => {
                  const newLevels = [...lightnessLevels];
                  newLevels[index] = parseInt(e.target.value) || 0;
                  setLightnessLevels(newLevels);
                }}
              />
            ))}
          </div>
        </ControlGroup>
      </Controls>

      <div
        css={`
          color: #ccc;
          font-size: 12px;
          margin-bottom: 8px;
        `}
      >
        Grid: {hueSteps} columns ×{' '}
        {(includeGrayscale ? 1 : 0)
          + saturationLevels.length * lightnessLevels.length}{' '}
        rows ({testColors.length} colors)
      </div>

      <GridContainer
        style={{ '--grid-columns': hueSteps } as React.CSSProperties}
      >
        {testColors.map((color) => {
          const Card = showOptimal ? OptimalContrastCard : ColorCard;

          return (
            <Card
              key={color}
              dynamicColor={dynamicColor.set(color)}
            >
              <div>Sample Text</div>
              <ColorInfo>{color.toUpperCase()}</ColorInfo>
              <ContrastValue>
                {showOptimal ? 'Optimal' : 'Auto'} Contrast
              </ContrastValue>
            </Card>
          );
        })}
      </GridContainer>

      <div
        css={`
          margin-top: 32px;
          padding: 16px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          color: #ccc;
          font-size: 14px;
          line-height: 1.5;
        `}
      >
        <strong>About Contrast:</strong>
        <br />• <strong>Auto Contrast (.contrast.var):</strong> Standard
        contrast calculation based on luminance
        <br />• <strong>Optimal Contrast (.contrast.optimal):</strong> Enhanced
        contrast for better accessibility
        <br />
        Toggle the checkbox above to compare both contrast methods across
        different background colors.
      </div>
    </DemoSection>
  );
}
