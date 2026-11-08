import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/main.ts')
                }
            }
        }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/preload.ts')
                }
            }
        }
    },
    renderer: {
        root: 'src',
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, 'src/index.html'),
                    splash: resolve(__dirname, 'src/splash.html'),
                    popup: resolve(__dirname, 'src/popup.html')
                }
            }
        }
    }
})
