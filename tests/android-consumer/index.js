import { createElement } from 'react'
import { Text } from 'react-native'
import { registerRootComponent } from 'expo'
import { SDK_VERSION, getConsent } from '@corlex/sdk-react-native'

// Import the actual SDK into Release bundles without initializing it or sending any data.
registerRootComponent(() => createElement(Text, null, `Corlex ${SDK_VERSION}: ${getConsent()}`))
