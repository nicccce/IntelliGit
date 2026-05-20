import type { JSX } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Alert, Button, Input, Segmented, Slider, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import { saveLlmConfig, checkLlmConnection } from '../../services/llmConfigService'
import { useGlobalSettingsPanelModel } from '../../viewModels'
import type { LlmConfig, LlmProvider } from '../../agent/types'
import { classNames } from '../../utils/classNames'
import styles from './GlobalSettingsPanel.module.css'

interface GlobalSettingsPanelProps {
  isOpen: boolean
  onClose: () => void
}

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI 兼容' },
  { value: 'anthropic', label: 'Anthropic' }
]

const PROVIDER_HINTS: Record<LlmProvider, string> = {
  openai: '兼容 OpenAI / DeepSeek / 通义千问 / 本地模型等，可自定义 Base URL',
  anthropic: '使用 Anthropic Claude API，填写 claude-3-5-sonnet-20241022 等模型名称'
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-20241022'
}

function getStatusLabel(status: string): string {
  if (status === 'ready') return '已连接'
  if (status === 'checking') return '检测中…'
  if (status === 'error') return '连接失败'
  return '未配置'
}

function GlobalSettingsPanel({ isOpen, onClose }: GlobalSettingsPanelProps): JSX.Element | null {
  if (!isOpen) return null

  return <GlobalSettingsPanelContent isOpen={isOpen} onClose={onClose} />
}

function GlobalSettingsPanelContent({ isOpen, onClose }: GlobalSettingsPanelProps): JSX.Element {
  const { config, status, error } = useGlobalSettingsPanelModel()

  const [provider, setProvider] = useState<LlmProvider>(config?.provider ?? 'openai')
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? '')
  const [modelName, setModelName] = useState(config?.modelName ?? DEFAULT_MODELS[config?.provider ?? 'openai'])
  const [temperature, setTemperature] = useState(config?.temperature ?? 0.2)
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ?? 4096)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const initialValues = useMemo(
    () => ({
      provider: config?.provider ?? 'openai',
      apiKey: config?.apiKey ?? '',
      baseUrl: config?.baseUrl ?? '',
      modelName: config?.modelName ?? DEFAULT_MODELS[config?.provider ?? 'openai'],
      temperature: config?.temperature ?? 0.2,
      maxTokens: config?.maxTokens ?? 4096
    }),
    [config]
  )

  const isDirty =
    provider !== initialValues.provider ||
    apiKey !== initialValues.apiKey ||
    baseUrl !== initialValues.baseUrl ||
    modelName !== initialValues.modelName ||
    temperature !== initialValues.temperature ||
    maxTokens !== initialValues.maxTokens

  const handleProviderChange = useCallback(
    (value: string) => {
      const next = value as LlmProvider
      setProvider(next)
      if (!modelName || modelName === DEFAULT_MODELS[provider]) {
        setModelName(DEFAULT_MODELS[next])
      }
    },
    [modelName, provider]
  )

  const handleSave = useCallback(async () => {
    if (!apiKey.trim() || !modelName.trim()) return
    setSaving(true)
    try {
      const newConfig: LlmConfig = {
        provider,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl.trim() || undefined,
        modelName: modelName.trim(),
        temperature,
        maxTokens
      }
      await saveLlmConfig(newConfig)
    } finally {
      setSaving(false)
    }
  }, [provider, apiKey, baseUrl, modelName, temperature, maxTokens])

  const handleClear = useCallback(async () => {
    setSaving(true)
    try {
      await saveLlmConfig(undefined)
      setApiKey('')
      setBaseUrl('')
      setModelName(DEFAULT_MODELS[provider])
      setTemperature(0.2)
      setMaxTokens(4096)
    } finally {
      setSaving(false)
    }
  }, [provider])

  const handleTest = useCallback(async () => {
    setTesting(true)
    try {
      await checkLlmConnection()
    } finally {
      setTesting(false)
    }
  }, [])

  const canSave = !saving && apiKey.trim().length > 0 && modelName.trim().length > 0 && isDirty
  const canTest = !testing && !!config && !isDirty

  return (
    <SidePanelShell title="全局设置" isOpen={isOpen} onClose={onClose}>
      <div className={styles['ig-global-settings']}>
        {/* AI 服务配置 */}
        <div className={styles['ig-settings-section']}>
          <h3>AI 服务</h3>

          <div className={styles['ig-form-group']}>
            <label>服务商</label>
            <Segmented
              className={styles['ig-provider-selector']}
              block
              value={provider}
              onChange={handleProviderChange}
              options={PROVIDER_OPTIONS}
            />
            <p className={styles['ig-hint']}>{PROVIDER_HINTS[provider]}</p>
          </div>

          <div className={styles['ig-form-group']}>
            <label>API Key</label>
            <Input.Password
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
              autoComplete="off"
            />
          </div>

          {provider === 'openai' && (
            <div className={styles['ig-form-group']}>
              <label>Base URL（可选）</label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com（留空使用默认）"
              />
            </div>
          )}

          <div className={styles['ig-form-group']}>
            <label>模型名称</label>
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder={DEFAULT_MODELS[provider]}
            />
          </div>

          <div className={styles['ig-form-group']}>
            <label>Temperature（{temperature.toFixed(1)}）</label>
            <Slider
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={setTemperature}
            />
          </div>

          <div className={styles['ig-form-group']}>
            <label>Max Tokens（{maxTokens}）</label>
            <Slider
              min={512}
              max={16384}
              step={512}
              value={maxTokens}
              onChange={setMaxTokens}
            />
          </div>

          {/* 连接状态 */}
          <div className={styles['ig-connection-status']}>
            <span className={classNames(styles['ig-status-dot'], styles[status])} />
            <span className={styles['ig-status-text']}>
              {getStatusLabel(status)}
              {status === 'error' && error ? `：${error}` : ''}
            </span>
            <Tooltip title="测试当前保存的配置是否可用">
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                loading={testing}
                disabled={!canTest}
                onClick={handleTest}
              />
            </Tooltip>
          </div>

          {status === 'error' && (
            <Alert
              type="error"
              showIcon
              message="AI 服务连接失败，请检查 API Key 和网络配置"
            />
          )}

          <div className={styles['ig-actions']}>
            <Button
              type="primary"
              loading={saving}
              disabled={!canSave}
              onClick={handleSave}
            >
              保存配置
            </Button>
            {config && (
              <Button danger loading={saving} onClick={handleClear}>
                清除配置
              </Button>
            )}
          </div>
        </div>
      </div>
    </SidePanelShell>
  )
}

export default GlobalSettingsPanel
