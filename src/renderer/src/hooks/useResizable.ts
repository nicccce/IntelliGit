/**
 * @file useResizable
 * @description 通用拖拽调整尺寸 Hook，支持水平和垂直方向，含最小/最大比例限制。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface UseResizableOptions {
  /** 方向：horizontal（左右拖拽）| vertical（上下拖拽） */
  direction: 'horizontal' | 'vertical'
  /** 初始比例（百分比 0~1） */
  defaultRatio: number
  /** 最小比例（百分比 0~1） */
  minRatio?: number
  /** 最大比例（百分比 0~1） */
  maxRatio?: number
  /** 容器 ref */
  containerRef: React.RefObject<HTMLElement | null>
}

interface UseResizableReturn {
  /** 当前比例（百分比 0~1） */
  ratio: number
  /** 拖拽手柄的 onMouseDown 事件处理器 */
  handleMouseDown: (e: React.MouseEvent) => void
  /** 是否正在拖拽 */
  isDragging: boolean
}

export function useResizable({
  direction,
  defaultRatio,
  minRatio = 0.15,
  maxRatio = 0.85,
  containerRef
}: UseResizableOptions): UseResizableReturn {
  const [ratio, setRatio] = useState(defaultRatio)
  const [isDragging, setIsDragging] = useState(false)
  const startPosRef = useRef(0)
  const startRatioRef = useRef(defaultRatio)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setIsDragging(true)
      if (direction === 'horizontal') {
        startPosRef.current = e.clientX
      } else {
        startPosRef.current = e.clientY
      }
      startRatioRef.current = ratio
    },
    [direction, ratio]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return

      const container = containerRef.current
      const containerRect = container.getBoundingClientRect()
      const containerSize = direction === 'horizontal' ? containerRect.width : containerRect.height

      let delta: number
      if (direction === 'horizontal') {
        delta = e.clientX - startPosRef.current
      } else {
        delta = e.clientY - startPosRef.current
      }

      let newRatio = startRatioRef.current + delta / containerSize
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio))
      setRatio(newRatio)
    },
    [isDragging, direction, minRatio, maxRatio, containerRef]
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (!isDragging) return

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, handleMouseMove, handleMouseUp])

  return { ratio, handleMouseDown, isDragging }
}
