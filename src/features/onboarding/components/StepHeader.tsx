import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../../design';
import { Icon, Text } from '../../../design/components';

export interface StepHeaderProps {
  steps: string[];
  /**
   * Zero-based. Steps before it read as done. Passing `steps.length` marks
   * every step done, which is what the finished import shows.
   */
  activeIndex: number;
}

/**
 * Section 9.4: "the screen shows both as numbered steps across the top: Find
 * accounts, then Read payments."
 */
export function StepHeader({ steps, activeIndex }: StepHeaderProps) {
  const theme = useTheme();

  return (
    <View
      accessibilityRole="header"
      accessibilityLabel={
        activeIndex >= steps.length
          ? 'All steps complete'
          : `Step ${activeIndex + 1} of ${steps.length}: ${steps[activeIndex]}`
      }
      style={styles.row}>
      {steps.map((step, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        const tint = done || active ? theme.color.primary : theme.color.borderStrong;

        return (
          <React.Fragment key={step}>
            {index > 0 ? (
              <View
                style={[
                  styles.connector,
                  { backgroundColor: done ? theme.color.primary : theme.color.borderStrong },
                ]}
              />
            ) : null}
            <View style={styles.step}>
              <View
                style={[
                  styles.marker,
                  {
                    borderColor: tint,
                    backgroundColor: done ? theme.color.primary : 'transparent',
                  },
                ]}>
                {done ? (
                  <Icon name="check" size={12} color={theme.color.onPrimary} strokeWidth={2.6} />
                ) : (
                  <Text
                    variant="caption"
                    style={{ color: active ? theme.color.primary : theme.color.textMuted }}>
                    {index + 1}
                  </Text>
                )}
              </View>
              <Text
                variant="label"
                tone={active || done ? 'primary' : 'muted'}
                numberOfLines={1}>
                {step}
              </Text>
            </View>
          </React.Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  marker: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: { flex: 1, height: 1.5, borderRadius: 1, minWidth: 16 },
});
