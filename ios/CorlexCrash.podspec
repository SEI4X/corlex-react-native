require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'CorlexCrash'
  s.version        = package['version']
  s.summary        = 'Native crash capture for the Corlex React Native SDK'
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '16.4', :tvos => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://github.com/SEI4X/corlex-react-native.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Only to read ATTrackingManager.trackingAuthorizationStatus (no permission, no prompt).
  s.frameworks = 'AppTrackingTransparency'

  s.source_files = '**/*.{h,c,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
