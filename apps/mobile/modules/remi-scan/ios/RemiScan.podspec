Pod::Spec.new do |s|
  s.name = 'RemiScan'
  s.version = '1.0.0'
  s.summary = 'Local receipt image processing'
  s.license = 'MIT'
  s.author = 'Remi'
  s.homepage = 'https://github.com/nathandalpatan/remi'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/nathandalpatan/remi.git' }
  s.source_files = '**/*.swift'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
end
