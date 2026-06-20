import type { JSX } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Input, Segmented, Slider, Switch, Tooltip } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

import SidePanelShell from '../../components/SidePanelShell'
import { saveLlmConfig, checkLlmConnection } from '../../services/llmConfigService'
import { useGlobalSettingsPanelModel } from '../../viewModels'
import type { LlmConfig, LlmProvider, SafetyPolicyConfig } from '../../../../shared/types'
import { loadConfig, saveConfig as saveAppConfig } from '../../api/configClient'
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
  openai: 'deepseek-chat',
  anthropic: 'claude-3-5-sonnet-20241022'
}

const DEFAULT_BASE_URLS: Partial<Record<LlmProvider, string>> = {
  openai: 'https://api.deepseek.com'
}

const DEFAULT_SAFETY_POLICY: SafetyPolicyConfig = {
  allowForcePush: false,
  allowResetHard: false
}

function getStatusLabel(status: string): string {
  if (status === 'ready') return '已连接'
  if (status === 'checking') return '检测中…'
  if (status === 'error') return '连接失败'
  return '未配置'
}

function GlobalSettingsPanel({ isOpen, onClose }: GlobalSettingsPanelProps): JSX.Element | null {
  if (!isOpen) return null

  return <GlobalSettingsPanelContent onClose={onClose} />
}

interface GlobalSettingsPanelContentProps {
  onClose: () => void
}

function GlobalSettingsPanelContent({ onClose }: GlobalSettingsPanelContentProps): JSX.Element {
  const { config, status, error } = useGlobalSettingsPanelModel()

  const [provider, setProvider] = useState<LlmProvider>(config?.provider ?? 'openai')
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '')
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? DEFAULT_BASE_URLS[config?.provider ?? 'openai'] ?? '')
  const [modelName, setModelName] = useState(config?.modelName ?? DEFAULT_MODELS[config?.provider ?? 'openai'])
  const [temperature, setTemperature] = useState(config?.temperature ?? 0.2)
  const [maxTokens, setMaxTokens] = useState(config?.maxTokens ?? 4096)
  const [safetyPolicy, setSafetyPolicy] = useState<SafetyPolicyConfig>(DEFAULT_SAFETY_POLICY)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const initialValues = useMemo(() => {
    const configProvider = config?.provider ?? 'openai'

    return {
      provider: configProvider,
      apiKey: config?.apiKey ?? '',
      baseUrl: config?.baseUrl ?? DEFAULT_BASE_URLS[configProvider] ?? '',
      modelName: config?.modelName ?? DEFAULT_MODELS[configProvider],
      temperature: config?.temperature ?? 0.2,
      maxTokens: config?.maxTokens ?? 4096
    }
  }, [
    config?.apiKey,
    config?.baseUrl,
    config?.maxTokens,
    config?.modelName,
    config?.provider,
    config?.temperature
  ])

  useEffect(() => {
    void loadConfig().then((appConfig) => {
      setSafetyPolicy({ ...DEFAULT_SAFETY_POLICY, ...appConfig.safetyPolicy })
    })
  }, [])

  const updateSafetyPolicy = useCallback(async (patch: Partial<SafetyPolicyConfig>) => {
    const current = await loadConfig()
    const nextPolicy = { ...DEFAULT_SAFETY_POLICY, ...current.safetyPolicy, ...patch }
    setSafetyPolicy(nextPolicy)
    await saveAppConfig({ ...current, safetyPolicy: nextPolicy })
  }, [])

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
      if (!baseUrl || baseUrl === DEFAULT_BASE_URLS[provider]) {
        setBaseUrl(DEFAULT_BASE_URLS[next] ?? '')
      }
    },
    [baseUrl, modelName, provider]
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
      setBaseUrl(DEFAULT_BASE_URLS[provider] ?? '')
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
    <SidePanelShell title="全局设置" isOpen={true} onClose={onClose}>
      <div className={styles['ig-global-settings']}>
        {/* AI 服务配置 */}
        <div className={styles['ig-settings-section']}>
          <div className={styles['ig-section-title']}>
            <h3>AI 服务</h3>
            <span>{config ? '已保存模型配置' : '未配置，可先填写后保存'}</span>
          </div>

          {!config && (
            <Empty
              className={styles['ig-settings-empty']}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="配置 AI 服务后，可用于智能生成提交信息和变更分组"
            />
          )}

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
                placeholder="https://api.deepseek.com（兼容 OpenAI 协议）"
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
              description="AI 服务连接失败，请检查 API Key 和网络配置"
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

        <div className={styles['ig-settings-section']}>
          <div className={styles['ig-section-title']}>
            <h3>安全策略</h3>
            <span>默认拦截极高危 Git 操作；开启后降级为高危并要求二次确认</span>
          </div>
          <div className={styles['ig-form-group']}>
            <label>允许执行 force push</label>
            <Switch
              checked={safetyPolicy.allowForcePush}
              onChange={(checked) => updateSafetyPolicy({ allowForcePush: checked })}
            />
            <p className={styles['ig-hint']}>解锁 git push --force / --force-with-lease 等操作。</p>
          </div>
          <div className={styles['ig-form-group']}>
            <label>允许执行 reset --hard</label>
            <Switch
              checked={safetyPolicy.allowResetHard}
              onChange={(checked) => updateSafetyPolicy({ allowResetHard: checked })}
            />
            <p className={styles['ig-hint']}>解锁 git reset --hard 操作，仍会弹出高危确认。</p>
          </div>
        </div>
      </div>
    </SidePanelShell>
  )
}

export default GlobalSettingsPanel
