import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'

interface EChartProps {
  option: echarts.EChartsOption
  height?: number
  /** 图表事件（如 { click: (params) => ... }），随组件生命周期绑定 */
  onEvents?: Record<string, (params: unknown) => void>
}

/** 轻量 ECharts React 封装：初始化、option 更新、尺寸自适应、可选事件 */
export default function EChart({ option, height = 320, onEvents }: EChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    chartRef.current = chart
    const observer = new ResizeObserver(() => chart.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chart.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true })
  }, [option])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !onEvents) return
    for (const [event, handler] of Object.entries(onEvents)) {
      chart.on(event, handler)
    }
    return () => {
      for (const event of Object.keys(onEvents)) chart.off(event)
    }
  }, [onEvents])

  return <div ref={ref} style={{ width: '100%', height }} />
}
