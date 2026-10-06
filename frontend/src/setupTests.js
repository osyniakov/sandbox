import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { __resetPhotoBlobCacheForTests } from './photoBlobCache.js'

afterEach(() => __resetPhotoBlobCacheForTests())
