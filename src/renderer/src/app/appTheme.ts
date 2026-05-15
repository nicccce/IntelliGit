import type { ThemeConfig } from 'antd'
import { theme as antdTheme } from 'antd'

import type { AppThemeMode } from './types'

export const ANT_THEME_TOKENS: Record<AppThemeMode, ThemeConfig> = {
  dark: {
    algorithm: antdTheme.darkAlgorithm,
    token: {
      colorPrimary: '#2f81f7',
      colorSuccess: '#1f9d6f',
      colorWarning: '#b7791f',
      colorError: '#e05252',
      colorInfo: '#2f81f7',
      borderRadius: 6,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      colorBgBase: '#0f1218',
      colorBgContainer: '#161b22',
      colorBorder: '#303845',
      colorTextBase: '#e8edf4'
    },
    components: {
      Button: { controlHeight: 30, borderRadius: 6 },
      Input: { controlHeight: 30, borderRadius: 6 },
      Modal: { borderRadiusLG: 8 },
      Segmented: { borderRadius: 6 }
    }
  },
  light: {
    algorithm: antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#185fa5',
      colorSuccess: '#1d9e75',
      colorWarning: '#ba7517',
      colorError: '#d64545',
      colorInfo: '#185fa5',
      borderRadius: 6,
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      colorBgBase: '#f5f7fb',
      colorBgContainer: '#ffffff',
      colorBorder: '#d8dee8',
      colorTextBase: '#1f2937'
    },
    components: {
      Button: { controlHeight: 30, borderRadius: 6 },
      Input: { controlHeight: 30, borderRadius: 6 },
      Modal: { borderRadiusLG: 8 },
      Segmented: { borderRadius: 6 }
    }
  }
}
