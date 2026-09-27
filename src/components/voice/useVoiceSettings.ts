'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_VOICE_SETTINGS,
  loadVoiceSettings,
  parseVoiceSettings,
  saveVoiceSettings,
  type VoiceSettings,
} from '@/lib/voice/settings';

/** Voice preferences from localStorage (loaded after hydration, saved on change). */
export function useVoiceSettings() {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Deferred so the first client render matches the server markup
    const id = requestAnimationFrame(() => {
      setSettings(loadVoiceSettings());
      setLoaded(true);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (loaded) saveVoiceSettings(settings);
  }, [settings, loaded]);

  const updateSettings = useCallback((patch: Partial<VoiceSettings>) => {
    setSettings((prev) => parseVoiceSettings({ ...prev, ...patch }));
  }, []);

  return { settings, updateSettings };
}
